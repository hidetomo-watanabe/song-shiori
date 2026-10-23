// 曲のしおり API（Cloudflare Workers + D1）。要件定義書 5.4・5.5・16.3
import { validateSong, type Song } from '../../shared/song';
import { lookupBpm, norm } from './bpm';

type Env = { DB: D1Database; ALLOWED_ORIGINS: string; SALT?: string; GETSONGBPM_KEY?: string };

const DAY = 864e5;
const KEEP_DAYS = 180; // 構成メモの保持期間
const SESSION_DAYS = 30;
const KEEP_VERSIONS = 10;
const EVENT_DAYS = 90;
const MAX_BODY = 512 * 1024;
const EVENT_KINDS = new Set(['analysis_ok', 'analysis_fail', 'manual_start', 'loop_play', 'view_after_update', 'bpm_lookup_applied', 'youtube_set', 'youtube_view_play']);
const BPM_CACHE_SECONDS = 7 * 86400;
const BPM_LOOKUP_VERSION = 2; // 2：曲名がそのまま一致する候補を先にする

const HEX = (n: number) => new RegExp(`^[a-f0-9]{${n}}$`);
const isKey = (s: unknown): s is string => typeof s === 'string' && HEX(48).test(s);

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

// IP 単位の緩やかな回数制限（1時間ごと）
async function limit(req: Request, env: Env, kind: string, max: number) {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  const hour = Math.floor(Date.now() / 36e5);
  const bucket = `${kind}:${hour}:${(await digest(`${env.SALT ?? 'song-shiori'}:${ip}`)).slice(0, 32)}`;
  const row = await env.DB.prepare(
    'INSERT INTO rate_limits (bucket, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count',
  ).bind(bucket, (hour + 2) * 36e5).first<{ count: number }>();
  if ((row?.count ?? 0) > max) throw new HttpError(429, '短時間に操作が集中しています。しばらくしてから再試行してください');
}

type MemoRow = {
  id: string; view_id: string | null; key_hash: string; key_gen: number;
  edit_key_hash: string | null; edit_key_gen: number; version: number; updated_at: number; expires_at: number;
};
// admin：管理キー（作成者）。すべての操作ができる。edit：編集キー（メンバー）。構成の編集と保存だけ
type Role = 'admin' | 'edit';

async function findMemo(env: Env, id: string): Promise<MemoRow> {
  if (!HEX(24).test(id)) throw new HttpError(404, NOT_FOUND);
  const row = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first<MemoRow>();
  if (!row || row.expires_at < Date.now()) throw new HttpError(404, NOT_FOUND);
  return row;
}

async function newSession(env: Env, memo: { id: string; key_gen: number; edit_key_gen?: number }, role: Role = 'admin') {
  const token = random(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, memo_id, key_gen, expires_at, role) VALUES (?, ?, ?, ?, ?)')
    .bind(await digest(token), memo.id, role === 'admin' ? memo.key_gen : memo.edit_key_gen ?? 1, Date.now() + SESSION_DAYS * DAY, role).run();
  return token;
}

// キーから役割を決める（管理キーなら admin、編集キーなら edit、どちらでもなければ null）
async function roleOf(memo: MemoRow, key: string | null): Promise<Role | null> {
  if (!isKey(key)) return null;
  const h = await digest(key);
  return h === memo.key_hash ? 'admin' : memo.edit_key_hash && h === memo.edit_key_hash ? 'edit' : null;
}

// 編集セッションを検証する。キー再発行で世代が変わったセッションは無効
// 編集セッションを検証する。キー再発行で世代が変わったセッションは無効。need が admin なら管理キーのセッションだけ通す
async function authorize(req: Request, env: Env, id: string, need: Role = 'edit'): Promise<MemoRow & { role: Role }> {
  const memo = await findMemo(env, id);
  const token = bearer(req);
  if (!token || !HEX(64).test(token)) throw new HttpError(401, '編集するには編集キーか管理キーを入力してください');
  const role = await sessionRole(env, memo, token);
  if (!role) throw new HttpError(401, '編集の有効期限が切れたか、キーが再発行されました。キーを入力し直してください');
  if (need === 'admin' && role !== 'admin') throw new HttpError(403, 'この操作は管理キーでのみできます');
  return { ...memo, role };
}

// セッションの役割。キー再発行で世代が変わった・期限切れ・編集が止められたセッションは null
async function sessionRole(env: Env, memo: MemoRow, token: string): Promise<Role | null> {
  const s = await env.DB.prepare('SELECT key_gen, expires_at, role FROM sessions WHERE token_hash = ? AND memo_id = ?')
    .bind(await digest(token), memo.id).first<{ key_gen: number; expires_at: number; role: Role }>();
  const gen = s?.role === 'edit' ? memo.edit_key_gen : memo.key_gen;
  return !s || s.key_gen !== gen || s.expires_at < Date.now() || (s.role === 'edit' && !memo.edit_key_hash) ? null : s.role;
}

const info = (m: MemoRow) => ({ id: m.id, viewId: m.view_id, version: m.version, updatedAt: m.updated_at, expiresAt: m.expires_at, editKey: !!m.edit_key_hash });

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
  const { requestId, key, editKey, song } = await body<{ requestId: string; key: string; editKey?: string; song: unknown }>(req);
  if (typeof requestId !== 'string' || !HEX(32).test(requestId) || !isKey(key) || (editKey != null && (!isKey(editKey) || editKey === key))) throw new HttpError(400, '形式が正しくありません');
  const data = checkSong(song);
  const keyHash = await digest(key);
  // 同じ作成リクエストの再送には、同じ曲メモを返す
  const existing = await env.DB.prepare('SELECT * FROM memos WHERE create_request = ?').bind(requestId).first<MemoRow>();
  if (existing) {
    if (existing.key_hash !== keyHash) throw new HttpError(409, '作成済みです');
    return json({ ...info(existing), session: await newSession(env, existing), role: 'admin' });
  }
  await limit(req, env, 'create', 30);
  const now = Date.now();
  const editHash = editKey ? await digest(editKey) : null;
  const memo: MemoRow = { id: random(12), view_id: random(16), key_hash: keyHash, key_gen: 1, edit_key_hash: editHash, edit_key_gen: 1, version: 1, updated_at: now, expires_at: now + KEEP_DAYS * DAY };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO memos (id, view_id, key_hash, key_gen, edit_key_hash, edit_key_gen, create_request, version, title, created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, ?, 1, ?, 1, ?, ?, ?, ?)')
      .bind(memo.id, memo.view_id, keyHash, editHash, requestId, data.title, now, now, memo.expires_at),
    env.DB.prepare('INSERT INTO memo_versions (memo_id, version, saved_at, data, note, notify) VALUES (?, 1, ?, ?, \'\', 1)')
      .bind(memo.id, now, JSON.stringify(data)),
  ]);
  return json({ ...info(memo), session: await newSession(env, memo), role: 'admin' }, 201);
}

// 閲覧：最新版と、差分表示の基準になる版を返す
async function viewMemo(req: Request, env: Env, viewId: string) {
  if (!HEX(32).test(viewId)) throw new HttpError(404, NOT_FOUND);
  const memo = await env.DB.prepare('SELECT * FROM memos WHERE view_id = ?').bind(viewId).first<MemoRow>();
  if (!memo || memo.expires_at < Date.now()) throw new HttpError(404, NOT_FOUND);
  const { results } = await env.DB.prepare('SELECT version, data, note, notify FROM memo_versions WHERE memo_id = ? ORDER BY version')
    .bind(memo.id).all<{ version: number; data: string; note: string; notify: number }>();
  const latest = results[results.length - 1];
  const sinceParam = Number(new URL(req.url).searchParams.get('since'));
  const since = Number.isInteger(sinceParam) && sinceParam > 0 ? sinceParam : null;
  // 端末の記録がなければ直前の版、あればその版（残っていなければ最も古い版）と比べる
  let base: (typeof results)[number] | undefined = since ? results.find((r) => r.version === since) ?? results[0] : results[results.length - 2];
  if (base && base.version >= latest.version) base = undefined;
  const after = base ? results.filter((r) => r.version > base!.version) : [];
  const notify = after.some((r) => r.notify === 1);
  return json({
    version: memo.version, updatedAt: memo.updated_at, expiresAt: memo.expires_at,
    song: JSON.parse(latest.data),
    base: base && notify ? { version: base.version, song: JSON.parse(base.data) } : null,
    notify,
    notes: after.filter((r) => r.notify === 1 && r.note).map((r) => ({ version: r.version, note: r.note })),
  });
}

async function saveMemo(req: Request, env: Env, memo: MemoRow) {
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
  try {
    const [upd] = await env.DB.batch([
      env.DB.prepare('UPDATE memos SET version = ?, title = ?, updated_at = ?, expires_at = ? WHERE id = ? AND version = ?')
        .bind(next, data.title, now, now + KEEP_DAYS * DAY, memo.id, baseVersion),
      env.DB.prepare('INSERT INTO memo_versions (memo_id, version, saved_at, data, note, notify) SELECT id, version, ?, ?, ?, ? FROM memos WHERE id = ? AND version = ? AND updated_at = ?')
        .bind(now, JSON.stringify(data), note ?? '', notify === false ? 0 : 1, memo.id, next, now),
      env.DB.prepare('DELETE FROM memo_versions WHERE memo_id = ? AND version <= ?').bind(memo.id, next - KEEP_VERSIONS),
    ]);
    if (!upd.meta.changes) throw new Error('conflict');
  } catch {
    const cur = await findMemo(env, memo.id);
    throw new HttpError(409, '他の端末で更新されています', { version: cur.version, updatedAt: cur.updated_at });
  }
  return json(info({ ...memo, version: next, updated_at: now, expires_at: now + KEEP_DAYS * DAY }));
}

async function deleteMemo(env: Env, id: string) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM memo_versions WHERE memo_id = ?').bind(id),
    env.DB.prepare('DELETE FROM sessions WHERE memo_id = ?').bind(id),
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

// トップの「このブラウザで編集した曲メモ」の今の状態。
// 有効な編集セッションがあれば曲名・更新日時・期限を返し、なければ有無だけを返す（有無は ID だけでも他の API で分かる）
const STATUS_MAX = 50;
async function memoStatus(req: Request, env: Env) {
  const { items } = await body<{ items?: { id?: unknown; session?: unknown }[] }>(req);
  if (!Array.isArray(items) || items.length > STATUS_MAX) throw new HttpError(400, '形式が正しくありません');
  await limit(req, env, 'status', 120);
  const now = Date.now();
  const result = await Promise.all(items.map(async (item) => {
    const { id, session } = item ?? {};
    if (typeof id !== 'string' || !HEX(24).test(id)) return null;
    const memo = await env.DB.prepare('SELECT * FROM memos WHERE id = ?').bind(id).first<MemoRow & { title: string }>();
    if (!memo || memo.expires_at < now) return { id, gone: true };
    if (typeof session !== 'string' || !HEX(64).test(session) || !(await sessionRole(env, memo, session))) return { id };
    return { id, title: memo.title, updatedAt: memo.updated_at, expiresAt: memo.expires_at };
  }));
  return json({ items: result.filter(Boolean) });
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const m = req.method;
  if (path === '/api/memos' && m === 'POST') return createMemo(req, env);
  if (path === '/api/events' && m === 'POST') return recordEvent(req, env);
  if (path === '/api/bpm' && m === 'GET') return bpmInfo(req, env);
  if (path === '/api/memos/status' && m === 'POST') return memoStatus(req, env);
  let match = path.match(/^\/api\/view\/([^/]+)$/);
  if (match && m === 'GET') return viewMemo(req, env, match[1]);
  // 閲覧ページから編集を始める：閲覧識別子と、編集キーまたは管理キー
  match = path.match(/^\/api\/view\/([a-f0-9]{32})\/session$/);
  if (match && m === 'POST') {
    await limit(req, env, 'session', 30);
    const memo = await env.DB.prepare('SELECT * FROM memos WHERE view_id = ?').bind(match[1]).first<MemoRow>();
    if (!memo || memo.expires_at < Date.now()) throw new HttpError(404, NOT_FOUND);
    const role = await roleOf(memo, bearer(req));
    if (!role) throw new HttpError(403, 'キーが正しくありません');
    return json({ id: memo.id, role, session: await newSession(env, memo, role) });
  }

  match = path.match(/^\/api\/memos\/([^/]+)(\/session|\/keys|\/edit-key|\/share|\/extend)?$/);
  if (!match) throw new HttpError(404, '見つかりません');
  const [, id, sub] = match;

  if (sub === '/session' && m === 'POST') {
    await limit(req, env, 'session', 30);
    const memo = await findMemo(env, id);
    const role = await roleOf(memo, bearer(req));
    if (!role) throw new HttpError(403, 'キーが正しくありません');
    return json({ session: await newSession(env, memo, role), role });
  }

  // 構成の取得と保存は編集キーでもできる。それ以外（削除・キーや共有の管理・期限の延長）は管理キーだけ
  const memo = await authorize(req, env, id, !sub && (m === 'GET' || m === 'PUT') ? 'edit' : 'admin');
  if (!sub && m === 'GET') {
    const song = await readVersion(env, id, memo.version);
    return json({ ...info(memo), song, role: memo.role });
  }
  if (!sub && m === 'PUT') return saveMemo(req, env, memo);
  if (!sub && m === 'DELETE') { await deleteMemo(env, id); return json(null, 204); }
  if (sub === '/keys' && m === 'POST') {
    // 管理キーの再発行：旧管理キーと管理キーのセッションを無効にする（編集キーはそのまま）
    const { key } = await body<{ key: string }>(req);
    if (!isKey(key) || (memo.edit_key_hash && (await digest(key)) === memo.edit_key_hash)) throw new HttpError(400, '形式が正しくありません');
    const gen = memo.key_gen + 1;
    await env.DB.batch([
      env.DB.prepare('UPDATE memos SET key_hash = ?, key_gen = ? WHERE id = ?').bind(await digest(key), gen, id),
      env.DB.prepare("DELETE FROM sessions WHERE memo_id = ? AND role = 'admin'").bind(id),
    ]);
    return json({ session: await newSession(env, { id, key_gen: gen }) });
  }
  if (sub === '/edit-key' && (m === 'POST' || m === 'DELETE')) {
    // 編集キーの発行・再発行（POST）とメンバーの編集の停止（DELETE）。どちらも、それまでの編集キーのセッションを無効にする
    let hash: string | null = null;
    if (m === 'POST') {
      const { key } = await body<{ key: string }>(req);
      if (!isKey(key) || (await digest(key)) === memo.key_hash) throw new HttpError(400, '形式が正しくありません');
      hash = await digest(key);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE memos SET edit_key_hash = ?, edit_key_gen = edit_key_gen + 1 WHERE id = ?').bind(hash, id),
      env.DB.prepare("DELETE FROM sessions WHERE memo_id = ? AND role = 'edit'").bind(id),
    ]);
    return json(info({ ...memo, edit_key_hash: hash, edit_key_gen: memo.edit_key_gen + 1 }));
  }
  if (sub === '/share' && (m === 'POST' || m === 'DELETE')) {
    const viewId = m === 'POST' ? random(16) : null;
    await env.DB.prepare('UPDATE memos SET view_id = ? WHERE id = ?').bind(viewId, id).run();
    return json(info({ ...memo, view_id: viewId }));
  }
  if (sub === '/extend' && m === 'POST') {
    const expires = Date.now() + KEEP_DAYS * DAY;
    await env.DB.prepare('UPDATE memos SET expires_at = ? WHERE id = ?').bind(expires, id).run();
    return json(info({ ...memo, expires_at: expires }));
  }
  throw new HttpError(404, '見つかりません');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' },
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

  // 期限切れのメモ・セッション・利用イベント・回数制限を削除する
  async scheduled(_: ScheduledController, env: Env) {
    const now = Date.now();
    const { results } = await env.DB.prepare('SELECT id FROM memos WHERE expires_at < ?').bind(now).all<{ id: string }>();
    for (const r of results) await deleteMemo(env, r.id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM usage_events WHERE at < ?').bind(now - EVENT_DAYS * DAY),
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
    ]);
  },
};
