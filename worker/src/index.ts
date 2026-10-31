// 曲のしおり API（Cloudflare Workers + D1）。要件定義書 5.4・5.5・16.3
import { deriveEditKey, isKey } from '../../shared/keys';
import { validateSong, type Song } from '../../shared/song';
import { lookupBpm, norm } from './bpm';
import { searchYoutube } from './youtube';

type Env = { DB: D1Database; ALLOWED_ORIGINS: string; SALT?: string; GETSONGBPM_KEY?: string; YOUTUBE_API_KEY?: string; OPERATORS?: string };

const DAY = 864e5;
const KEEP_DAYS = 180; // 構成メモの保持期間
const ACCOUNT_KEEP_DAYS = 365; // マイキーの一覧の保持期間（最後の同期から）
const ACCOUNT_MAX = 50000;
const KEEP_VERSIONS = 10;
// 有料の曲メモ（要件書 11.1）の期限。消えないよう、ずっと先の日付（9999-12-31）を入れる
const NO_EXPIRY = 253402214400000;
const EVENT_DAYS = 90;
const MAX_BODY = 512 * 1024;
const EVENT_KINDS = new Set(['analysis_ok', 'analysis_fail', 'manual_start', 'loop_play', 'view_after_update', 'bpm_lookup_applied', 'youtube_set', 'youtube_view_play']);
const BPM_CACHE_SECONDS = 7 * 86400;
const BPM_LOOKUP_VERSION = 2; // 2：曲名がそのまま一致する候補を先にする
const YOUTUBE_CACHE_SECONDS = 7 * 86400;
// YouTube の無料枠（1日 10,000 ユニット、検索1回で約 101）を使い切らないよう、サービス全体で1日の回数を絞る。
// 枠は太平洋時間の0時に戻るので、日付も太平洋時間で数える
const YOUTUBE_DAILY_MAX = 90;

const HEX = (n: number) => new RegExp(`^[a-f0-9]{${n}}$`);

const random = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
async function digest(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) { super(message); }
}

const NOT_FOUND = '曲メモが見つかりません。削除されたか、期限が切れた可能性があります';

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(data === null ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...headers },
  });

async function body<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'データが大きすぎます');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, '形式が正しくありません'); }
}

const bearer = (req: Request) => req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? null;

// 回数を1つ数えて、数えたあとの回数を返す
async function countUp(env: Env, bucket: string, expiresAt: number) {
  const row = await env.DB.prepare(
    'INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count',
  ).bind(bucket, expiresAt).first<{ count: number }>();
  return row?.count ?? 0;
}

// IP 単位の緩やかな回数制限（1時間ごと）
async function limit(req: Request, env: Env, kind: string, max: number) {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  const hour = Math.floor(Date.now() / 36e5);
  const bucket = `${kind}:${hour}:${(await digest(`${env.SALT ?? 'song-shiori'}:${ip}`)).slice(0, 32)}`;
  if ((await countUp(env, bucket, (hour + 2) * 36e5)) > max) throw new HttpError(429, '短時間に操作が集中しています。しばらくしてから再試行してください');
}

const pacificDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

type MemoRow = {
  id: string; view_id: string | null; key_hash: string; key_gen: number;
  edit_key_hash: string | null; edit_key_gen: number; version: number; updated_at: number; expires_at: number; paid: number;
};
// admin：管理キー（作成者）。すべての操作ができる。edit：編集キー（メンバー）。構成の編集と保存だけ
type Role = 'admin' | 'edit';

async function findMemo(env: Env, id: string): Promise<MemoRow> {
  if (!HEX(24).test(id)) throw new HttpError(404, NOT_FOUND);
  const row = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first<MemoRow>();
  if (!row || row.expires_at < Date.now()) throw new HttpError(404, NOT_FOUND);
  return row;
}

// キーから役割を決める（管理キーなら admin、編集キーなら edit、どちらでもなければ null）
async function roleOf(memo: MemoRow, key: string | null): Promise<Role | null> {
  if (!isKey(key)) return null;
  const h = await digest(key);
  return h === memo.key_hash ? 'admin' : memo.edit_key_hash && h === memo.edit_key_hash ? 'edit' : null;
}

// リンクのキー（Authorization）を確かめる。need が admin なら管理キーだけ通す
async function authorize(req: Request, env: Env, id: string, need: Role = 'edit'): Promise<MemoRow & { role: Role; key: string }> {
  const memo = await findMemo(env, id);
  const key = bearer(req);
  if (!key) throw new HttpError(401, '編集するには編集リンクか管理リンクが必要です');
  const role = await roleOf(memo, key);
  if (!role) throw new HttpError(401, 'キーが正しくありません。リンクが作り直された可能性があります。新しいリンクを確認してください');
  if (need === 'admin' && role !== 'admin') throw new HttpError(403, 'この操作は管理リンクでのみできます');
  return { ...memo, role, key };
}

const editHashOf = async (adminKey: string, gen: number) => digest(await deriveEditKey(adminKey, gen));

const info = (m: MemoRow) => ({ id: m.id, viewId: m.view_id, version: m.version, updatedAt: m.updated_at, expiresAt: m.expires_at, editKey: !!m.edit_key_hash, paid: !!m.paid });
// 管理キーで開いたときは、編集キーの世代も返す（画面で管理キーから編集リンクを作るため）。
// 導出する形より前に作った編集キー（ランダムな値）なら null（作り直すまで編集リンクは出せない）
const adminInfo = async (m: MemoRow, adminKey: string) => ({
  ...info(m),
  editKeyGen: m.edit_key_hash && (await editHashOf(adminKey, m.edit_key_gen)) === m.edit_key_hash ? m.edit_key_gen : null,
});
const infoFor = (m: MemoRow & { role: Role; key: string }) => (m.role === 'admin' ? adminInfo(m, m.key) : info(m));

function checkSong(song: unknown): Song {
  const err = validateSong(song);
  if (err) throw new HttpError(400, err);
  return song as Song;
}

async function readVersion(env: Env, id: string, version: number) {
  const row = await env.DB.prepare('SELECT data FROM memo_versions WHERE memo_id = ? AND version = ?').bind(id, version).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Song) : null;
}

async function createMemo(req: Request, env: Env) {
  const { requestId, key, song } = await body<{ requestId: string; key: string; song: unknown }>(req);
  if (typeof requestId !== 'string' || !HEX(32).test(requestId) || !isKey(key)) throw new HttpError(400, '形式が正しくありません');
  const data = checkSong(song);
  const keyHash = await digest(key);
  // 同じ作成リクエストの再送には、同じ曲メモを返す
  const existing = await env.DB.prepare('SELECT * FROM memos WHERE create_request = ?').bind(requestId).first<MemoRow>();
  if (existing) {
    if (existing.key_hash !== keyHash) throw new HttpError(409, '作成済みです');
    return json({ ...(await adminInfo(existing, key)), role: 'admin' });
  }
  await limit(req, env, 'create', 30);
  const now = Date.now();
  const editHash = await editHashOf(key, 1);
  const memo: MemoRow = { id: random(12), view_id: random(16), key_hash: keyHash, key_gen: 1, edit_key_hash: editHash, edit_key_gen: 1, version: 1, updated_at: now, expires_at: now + KEEP_DAYS * DAY, paid: 0 };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO memos (id, view_id, key_hash, key_gen, edit_key_hash, edit_key_gen, create_request, version, title, created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, ?, 1, ?, 1, ?, ?, ?, ?)')
      .bind(memo.id, memo.view_id, keyHash, editHash, requestId, data.title, now, now, memo.expires_at),
    env.DB.prepare('INSERT INTO memo_versions (memo_id, version, saved_at, data, note, notify) VALUES (?, 1, ?, ?, \'\', 1)')
      .bind(memo.id, now, JSON.stringify(data)),
  ]);
  return json({ ...(await adminInfo(memo, key)), role: 'admin' }, 201);
}

// 閲覧：最新版と、差分表示の基準になる版を返す
async function viewMemo(req: Request, env: Env, viewId: string) {
  if (!HEX(32).test(viewId)) throw new HttpError(404, NOT_FOUND);
  const memo = await env.DB.prepare('SELECT * FROM memos WHERE view_id = ?').bind(viewId).first<MemoRow>();
  if (!memo || memo.expires_at < Date.now()) throw new HttpError(404, NOT_FOUND);
  // 構成データは大きいので、版の一覧は data なしで読み、最新版と比べる版の data だけを後で読む
  const { results } = await env.DB.prepare('SELECT version, note, notify FROM memo_versions WHERE memo_id = ? ORDER BY version')
    .bind(memo.id).all<{ version: number; note: string; notify: number }>();
  const latest = results[results.length - 1];
  const sinceParam = Number(new URL(req.url).searchParams.get('since'));
  const since = Number.isInteger(sinceParam) && sinceParam > 0 ? sinceParam : null;
  // 端末の記録がなければ直前の版、あればその版（残っていなければ最も古い版）と比べる
  let base: (typeof results)[number] | undefined = since ? results.find((r) => r.version === since) ?? results[0] : results[results.length - 2];
  if (base && base.version >= latest.version) base = undefined;
  const after = base ? results.filter((r) => r.version > base!.version) : [];
  const notify = after.some((r) => r.notify === 1);
  const baseVersion = base && notify ? base.version : null;
  const { results: rows } = await env.DB.prepare('SELECT version, data FROM memo_versions WHERE memo_id = ? AND version IN (?, ?)')
    .bind(memo.id, latest.version, baseVersion ?? latest.version).all<{ version: number; data: string }>();
  const dataOf = (v: number) => { const r = rows.find((r) => r.version === v); return r ? (JSON.parse(r.data) as Song) : null; };
  // 読む間に保存が重なり、比べる版が古い版として消えていたら、差分なしで返す
  const baseSong = baseVersion ? dataOf(baseVersion) : null;
  return json({
    version: memo.version, updatedAt: memo.updated_at, expiresAt: memo.expires_at, paid: !!memo.paid,
    song: dataOf(latest.version),
    base: baseVersion && baseSong ? { version: baseVersion, song: baseSong } : null,
    notify,
    notes: after.filter((r) => r.notify === 1 && r.note).map((r) => ({ version: r.version, note: r.note })),
  });
}

async function saveMemo(req: Request, env: Env, memo: MemoRow & { role: Role; key: string }) {
  const { baseVersion, song, note, notify } = await body<{ baseVersion: number; song: unknown; note?: string; notify?: boolean }>(req);
  const data = checkSong(song);
  if (!Number.isInteger(baseVersion)) throw new HttpError(400, '形式が正しくありません');
  if (typeof note === 'string' && note.length > 500) throw new HttpError(400, '変更メモが長すぎます');
  await limit(req, env, 'save', 600);
  if (baseVersion !== memo.version) {
    throw new HttpError(409, '他の端末で更新されています', { version: memo.version, updatedAt: memo.updated_at });
  }
  const now = Date.now();
  const next = memo.version + 1;
  // 有料なら期限は延ばさず（期限なしのまま）、古い版も消さない
  const expires = memo.paid ? NO_EXPIRY : now + KEEP_DAYS * DAY;
  const keepFrom = memo.paid ? 0 : next - KEEP_VERSIONS;
  try {
    const [upd] = await env.DB.batch([
      env.DB.prepare('UPDATE memos SET version = ?, title = ?, updated_at = ?, expires_at = ? WHERE id = ? AND version = ?')
        .bind(next, data.title, now, expires, memo.id, baseVersion),
      env.DB.prepare('INSERT INTO memo_versions (memo_id, version, saved_at, data, note, notify) SELECT id, version, ?, ?, ?, ? FROM memos WHERE id = ? AND version = ? AND updated_at = ?')
        .bind(now, JSON.stringify(data), note ?? '', notify === false ? 0 : 1, memo.id, next, now),
      env.DB.prepare('DELETE FROM memo_versions WHERE memo_id = ? AND version <= ?').bind(memo.id, keepFrom),
    ]);
    if (!upd.meta.changes) throw new Error('conflict');
  } catch {
    const cur = await findMemo(env, memo.id);
    throw new HttpError(409, '他の端末で更新されています', { version: cur.version, updatedAt: cur.updated_at });
  }
  return json(await infoFor({ ...memo, version: next, updated_at: now, expires_at: expires }));
}

async function deleteMemo(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memo_versions WHERE memo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM memos WHERE id = ?').bind(id),
  ]);
}

async function recordEvent(req: Request, env: Env) {
  const e = await body<{ kind: string; anon?: string; device?: string; durationMs?: number; audioSec?: number; error?: string }>(req);
  if (!EVENT_KINDS.has(e.kind)) throw new HttpError(400, '形式が正しくありません');
  await limit(req, env, 'event', 300);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const short = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);
  await env.DB.prepare('INSERT INTO usage_events (kind, at, anon, device, duration_ms, audio_sec, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(e.kind, Date.now(), short(e.anon, 40), short(e.device, 10), num(e.durationMs), num(e.audioSec), short(e.error, 100)).run();
  return json(null, 204);
}

// ネット上の BPM 情報。曲名・アーティスト名だけを外部サービスへ送り、結果は7日間キャッシュする
async function bpmInfo(req: Request, env: Env) {
  const url = new URL(req.url);
  const title = (url.searchParams.get('title') ?? '').trim().slice(0, 200);
  const artist = (url.searchParams.get('artist') ?? '').trim().slice(0, 200);
  if (!title) throw new HttpError(400, '曲名を入力してください');
  // 使える情報源（キーの設定など）や、候補の選び方・並べ方（BPM_LOOKUP_VERSION）が変わったら別の結果として扱う
  const cacheKey = new Request(`https://cache.song-shiori/bpm?t=${encodeURIComponent(norm(title))}&a=${encodeURIComponent(norm(artist))}&s=${env.GETSONGBPM_KEY ? 'gd' : 'd'}&v=${BPM_LOOKUP_VERSION}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return json(await hit.json());
  await limit(req, env, 'bpm', 120);
  const result = await lookupBpm(title, artist, env.GETSONGBPM_KEY);
  const body = { candidates: result.candidates, sources: env.GETSONGBPM_KEY ? ['GetSongBPM', 'Deezer'] : ['Deezer'] };
  if (!result.errors.length) {
    await cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `max-age=${BPM_CACHE_SECONDS}` } }));
  } else console.warn('bpm lookup', result.errors);
  return json(body);
}

// 曲を検索：YouTube の動画。曲名・アーティスト名だけを Google へ送り、結果は7日間キャッシュする。
// API キーが設定されていなければ、使えないことだけを返す（画面は iTunes の結果だけを出す）
async function youtubeSearch(req: Request, env: Env) {
  const url = new URL(req.url);
  const title = (url.searchParams.get('title') ?? '').trim().slice(0, 200);
  const artist = (url.searchParams.get('artist') ?? '').trim().slice(0, 200);
  if (!title && !artist) throw new HttpError(400, '曲名を入力してください');
  if (!env.YOUTUBE_API_KEY) return json({ videos: [], available: false });
  const cacheKey = new Request(`https://cache.song-shiori/youtube?t=${encodeURIComponent(norm(title))}&a=${encodeURIComponent(norm(artist))}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(cacheKey);
  if (hit) return json(await hit.json());
  // 検索1回で無料枠を多く使うので、BPM より回数を絞る
  await limit(req, env, 'youtube', 30);
  // 今日の分を使い切ったら（サービス全体の回数か、Google の枠切れ）、枠が戻るまで Google に問い合わせない。
  // 画面は iTunes の結果だけを出し、今日の上限に達したこと（limited）を知らせる
  const day = pacificDay();
  const keep = Date.now() + 2 * DAY;
  const used = await env.DB.prepare('SELECT 1 FROM rate_limits WHERE bucket = ?').bind(`youtube-quota:${day}`).first();
  if (used || (await countUp(env, `youtube-day:${day}`, keep)) > YOUTUBE_DAILY_MAX) return json({ videos: [], available: false, limited: true });
  try {
    const body = { videos: await searchYoutube(title, artist, env.YOUTUBE_API_KEY), available: true };
    await cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `max-age=${YOUTUBE_CACHE_SECONDS}` } }));
    return json(body);
  } catch (e) {
    console.warn('youtube search', e);
    if (e instanceof Error && /quotaExceeded|dailyLimitExceeded/.test(e.message)) {
      await countUp(env, `youtube-quota:${day}`, keep);
      return json({ videos: [], available: false, limited: true });
    }
    throw new HttpError(502, 'YouTube を検索できませんでした');
  }
}

// トップの「このブラウザで編集した曲メモ」の今の状態。
// 正しいキーがあれば役割・曲名・更新日時・期限・有料かどうか・閲覧識別子を返し、なければ有無だけを返す（有無は ID だけでも他の API で分かる）
const STATUS_MAX = 50;
async function memoStatus(req: Request, env: Env) {
  const { items } = await body<{ items?: { id?: unknown; key?: unknown }[] }>(req);
  if (!Array.isArray(items) || items.length > STATUS_MAX) throw new HttpError(400, '形式が正しくありません');
  await limit(req, env, 'status', 120);
  const now = Date.now();
  // 曲メモはまとめて1回で読む
  const ids = [...new Set(items.map((item) => item?.id).filter((id): id is string => typeof id === 'string' && HEX(24).test(id)))];
  const { results: memos } = ids.length
    ? await env.DB.prepare(`SELECT * FROM memos WHERE id IN (${ids.map(() => '?').join(', ')})`).bind(...ids).all<MemoRow & { title: string }>()
    : { results: [] };
  const byId = new Map(memos.map((m) => [m.id, m]));
  const result = await Promise.all(items.map(async (item) => {
    const { id, key } = item ?? {};
    if (typeof id !== 'string' || !HEX(24).test(id)) return null;
    const memo = byId.get(id);
    if (!memo || memo.expires_at < now) return { id, gone: true };
    const role = await roleOf(memo, typeof key === 'string' ? key : null);
    if (!role) return { id };
    return { id, role, title: memo.title, updatedAt: memo.updated_at, expiresAt: memo.expires_at, paid: !!memo.paid, viewId: memo.view_id };
  }));
  return json({ items: result.filter(Boolean) });
}

// 運営者：シークレット OPERATORS に、運営者のマイキーの照合用キーの SHA-256（accounts.id と同じ値）をカンマ区切りで入れる。
// 課金を作るまでは、運営者だけが曲メモの無料・有料を切り替えられる（曲メモの管理キーと両方が要る）
async function isOperator(env: Env, auth: string | null) {
  if (!auth || !HEX(48).test(auth) || !env.OPERATORS) return false;
  const id = await digest(auth);
  return env.OPERATORS.split(',').map((s) => s.trim()).includes(id);
}

// マイキー（端末間でキーの一覧を揃える。ライブのしおりと同じ）。#/mine から使う
// 一覧は画面側でマイキーから作った鍵で暗号化してから送るため、サーバーは中身（各リンクのキー）を読めない。マイキーそのものも受け取らない（照合用キーはマイキーから導出）
// 最後の同期から1年使われなければ定期削除する。削除したら削除済みの印だけを1年残し、同じマイキーを持つ別の端末の同期で作り直されないようにする
async function account(req: Request, env: Env) {
  const token = bearer(req);
  if (!token || !HEX(48).test(token)) throw new HttpError(403, 'マイキーが必要です');
  const id = await digest(token);
  const now = Date.now();
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ? AND expires_at >= ?').bind(id, now)
    .first<{ data: string | null; revision: number; deleted: number }>();
  if (row?.deleted) throw new HttpError(410, 'このマイキーは削除されています');
  const keep = now + ACCOUNT_KEEP_DAYS * DAY;
  if (req.method === 'GET') {
    if (!row) throw new HttpError(404, 'マイキーのデータがありません');
    return json({ data: row.data, revision: row.revision });
  }
  if (req.method === 'DELETE') {
    if (!row) throw new HttpError(404, 'マイキーのデータがありません');
    await env.DB.prepare('UPDATE accounts SET data = NULL, deleted = 1, updated_at = ?, expires_at = ? WHERE id = ?').bind(now, keep, id).run();
    return json({ deleted: true });
  }
  if (req.method !== 'PUT') throw new HttpError(404, '見つかりません');
  const { data, revision } = await body<{ data?: unknown; revision?: unknown }>(req);
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(data) || data.length > ACCOUNT_MAX || !Number.isInteger(revision)) throw new HttpError(400, '形式が正しくありません');
  const conflict = () => new HttpError(409, '別の端末で同期されました。もう一度お試しください');
  if (revision !== (row?.revision ?? 0)) throw conflict();
  if (row) {
    const upd = await env.DB.prepare('UPDATE accounts SET data = ?, revision = ?, updated_at = ?, expires_at = ? WHERE id = ? AND revision = ? AND deleted = 0')
      .bind(data, row.revision + 1, now, keep, id, row.revision).run();
    if (!upd.meta.changes) throw conflict();
  } else {
    await limit(req, env, 'account', 30);
    // 期限切れで定期削除を待っている行は置き換える
    const ins = await env.DB.prepare('INSERT INTO accounts (id, data, revision, deleted, updated_at, expires_at) VALUES (?, ?, 1, 0, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, revision = 1, deleted = 0, updated_at = excluded.updated_at, expires_at = excluded.expires_at WHERE accounts.expires_at < ?')
      .bind(id, data, now, keep, now).run();
    if (!ins.meta.changes) throw conflict();
  }
  return json({ revision: (row?.revision ?? 0) + 1 });
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;
  if (path === '/api/memos' && m === 'POST') return createMemo(req, env);
  if (path === '/api/events' && m === 'POST') return recordEvent(req, env);
  if (path === '/api/bpm' && m === 'GET') return bpmInfo(req, env);
  if (path === '/api/youtube' && m === 'GET') return youtubeSearch(req, env);
  if (path === '/api/memos/status' && m === 'POST') return memoStatus(req, env);
  if (path === '/api/account') return account(req, env);
  if (path === '/api/operator' && m === 'GET') {
    await limit(req, env, 'status', 120);
    return json({ operator: await isOperator(env, bearer(req)) });
  }
  let match = path.match(/^\/api\/view\/([^/]+)$/);
  if (match && m === 'GET') return viewMemo(req, env, match[1]);
  // 閲覧ページから編集を始める：閲覧識別子と、編集キーまたは管理キー（リンクを持っていない人がキーを入れたとき）
  match = path.match(/^\/api\/view\/([a-f0-9]{32})\/open$/);
  if (match && m === 'POST') {
    await limit(req, env, 'session', 30);
    const memo = await env.DB.prepare('SELECT * FROM memos WHERE view_id = ?').bind(match[1]).first<MemoRow>();
    if (!memo || memo.expires_at < Date.now()) throw new HttpError(404, NOT_FOUND);
    const role = await roleOf(memo, bearer(req));
    if (!role) throw new HttpError(403, 'キーが正しくありません');
    return json({ id: memo.id, role });
  }

  match = path.match(/^\/api\/memos\/([^/]+)(\/keys|\/edit-key|\/share|\/extend|\/plan)?$/);
  if (!match) throw new HttpError(404, '見つかりません');
  const [, id, sub] = match;

  // 構成の取得と保存は編集キーでもできる。それ以外（削除・キーや共有の管理・期限の延長・無料と有料の切り替え）は管理キーだけ
  const memo = await authorize(req, env, id, !sub && (m === 'GET' || m === 'PUT') ? 'edit' : 'admin');
  if (!sub && m === 'GET') {
    const song = await readVersion(env, id, memo.version);
    return json({ ...(await infoFor(memo)), song, role: memo.role });
  }
  if (!sub && m === 'PUT') return saveMemo(req, env, memo);
  if (!sub && m === 'DELETE') { await deleteMemo(env, id); return json(null, 204); }
  if (sub === '/keys' && m === 'POST') {
    // 管理リンクの作り直し：管理キーを置き換える。編集キーは管理キーから導出するので、編集リンクも変わる（停止中ならそのまま）
    const { key } = await body<{ key: string }>(req);
    if (!isKey(key) || key === memo.key) throw new HttpError(400, '形式が正しくありません');
    const next = { ...memo, key_hash: await digest(key), edit_key_hash: memo.edit_key_hash && (await editHashOf(key, memo.edit_key_gen)) };
    await env.DB.prepare('UPDATE memos SET key_hash = ?, key_gen = key_gen + 1, edit_key_hash = ? WHERE id = ?').bind(next.key_hash, next.edit_key_hash, id).run();
    return json(await adminInfo(next, key));
  }
  if (sub === '/edit-key' && (m === 'POST' || m === 'DELETE')) {
    // 編集リンクの発行・作り直し（POST）とメンバーの編集の停止（DELETE）。どちらも世代を進め、それまでの編集リンクを使えなくする
    const gen = memo.edit_key_gen + 1;
    const hash = m === 'POST' ? await editHashOf(memo.key, gen) : null;
    await env.DB.prepare('UPDATE memos SET edit_key_hash = ?, edit_key_gen = ? WHERE id = ?').bind(hash, gen, id).run();
    return json(await adminInfo({ ...memo, edit_key_hash: hash, edit_key_gen: gen }, memo.key));
  }
  if (sub === '/share' && (m === 'POST' || m === 'DELETE')) {
    const viewId = m === 'POST' ? random(16) : null;
    await env.DB.prepare('UPDATE memos SET view_id = ? WHERE id = ?').bind(viewId, id).run();
    return json(await adminInfo({ ...memo, view_id: viewId }, memo.key));
  }
  // 保持期限の延長は有料の機能にする（要件書 11.1）。課金を作るまでは断り、無料は保存したときだけ期限が延びる
  if (sub === '/extend' && m === 'POST') throw new HttpError(403, '保持期限は保存すると、その日から180日に延びます');
  // 無料・有料の切り替え。有料にすると期限なし、無料に戻すとその日から180日（要件書 11.1）
  if (sub === '/plan' && m === 'POST') {
    if (!(await isOperator(env, req.headers.get('X-Account')))) throw new HttpError(403, '切り替えは運営者のマイキーでのみできます');
    const { paid } = await body<{ paid?: unknown }>(req);
    if (typeof paid !== 'boolean') throw new HttpError(400, '形式が正しくありません');
    const expires = paid ? NO_EXPIRY : Date.now() + KEEP_DAYS * DAY;
    await env.DB.prepare('UPDATE memos SET paid = ?, expires_at = ? WHERE id = ?').bind(paid ? 1 : 0, expires, id).run();
    return json(await adminInfo({ ...memo, paid: paid ? 1 : 0, expires_at: expires }, memo.key));
  }
  throw new HttpError(404, '見つかりません');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env);
    // 画面（許可したドメイン）以外からは受け付けない。ほかのサイトに埋め込まれて、外部の検索の枠を使われないように。
    // Origin はスクリプトなら偽れるので、守りの本体はキーと回数制限
    if (!headers['Access-Control-Allow-Origin']) return json({ error: 'このサイトからは使えません' }, 403);
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Account', 'Access-Control-Max-Age': '86400' },
      });
    }
    try {
      const res = await route(req, env);
      for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
      return res;
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...e.extra }, e.status, headers);
      console.error(e);
      return json({ error: 'サーバーでエラーが発生しました' }, 500, headers);
    }
  },

  // 期限切れのメモ・マイキーの一覧・利用イベント・回数制限を削除する
  async scheduled(_: ScheduledController, env: Env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM memo_versions WHERE memo_id IN (SELECT id FROM memos WHERE expires_at < ?)').bind(now),
      env.DB.prepare('DELETE FROM memos WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM accounts WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM usage_events WHERE at < ?').bind(now - EVENT_DAYS * DAY),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
    ]);
  },
};
