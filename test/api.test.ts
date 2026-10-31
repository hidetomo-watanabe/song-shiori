/// <reference types="node" />
// API（worker/src/index.ts）を、テスト用の D1 に対して動かす。外部の検索（Google・Deezer）は偽物に差し替える
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import worker from '../worker/src/index';
import { deriveEditKey } from '../shared/keys';
import { emptySong, newSection, normalize } from '../shared/song';
import { fakeD1 } from './d1';

type Env = Parameters<typeof worker.fetch>[1];
const ORIGIN = 'https://song-shiori.example';
const DAY = 864e5;
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

let env: Env;
let db: DatabaseSync;
let cached: Map<string, Response>;

beforeEach(() => {
  const f = fakeD1();
  db = f.db;
  env = { DB: f.d1, ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:5173`, SALT: 'test' };
  // 外部への問い合わせは、各テストで偽物に差し替えたときだけ通す
  vi.stubGlobal('fetch', async (url: string) => { throw new Error(`テストでは外部に問い合わせない：${url}`); });
  // Workers の Cache API（caches.default）
  cached = new Map();
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => cached.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { cached.set(req.url, res); },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

type Opts = { token?: string; origin?: string | null; ip?: string };
async function call(method: string, path: string, body?: unknown, { token, origin = ORIGIN, ip = '192.0.2.1' }: Opts = {}) {
  const res = await worker.fetch(new Request(`https://api.example${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json', 'CF-Connecting-IP': ip,
      ...(origin ? { Origin: origin } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, headers: res.headers, data: res.status === 204 ? null : await res.json() as any };
}

const song = normalize({ ...emptySong(32), title: 'テスト', bpmManual: 120, sections: [newSection(0, 16, { group: 'A' }), newSection(16, 32, { group: 'B' })] });
const renamed = { ...song, sections: [{ ...song.sections[0], name: 'イントロ', nameAuto: false }, song.sections[1]] };

async function create(key = hex(24)) {
  const c = await call('POST', '/api/memos', { requestId: hex(16), key, song });
  expect(c.status).toBe(201);
  return { key, id: c.data.id as string, viewId: c.data.viewId as string };
}

describe('呼び出し元のサイト', () => {
  it('許可したサイトだけ受け付け、CORS のヘッダーを返す', async () => {
    const ok = await call('GET', '/api/view/' + '0'.repeat(32));
    expect(ok.status).toBe(404);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect((await call('GET', '/api/bpm?title=x', undefined, { origin: null })).status).toBe(403);
    expect((await call('GET', '/api/bpm?title=x', undefined, { origin: 'https://example.com' })).status).toBe(403);
    expect((await call('OPTIONS', '/api/memos')).status).toBe(204);
  });
});

describe('曲メモ', () => {
  it('作成の再送は同じ曲メモを返し、不正な構成データは拒否する', async () => {
    const key = hex(24), requestId = hex(16);
    const c1 = await call('POST', '/api/memos', { requestId, key, song });
    expect(c1.status).toBe(201);
    expect(c1.data).toMatchObject({ editKey: true, editKeyGen: 1, role: 'admin' });
    const c2 = await call('POST', '/api/memos', { requestId, key, song });
    expect(c2.status).toBe(200);
    expect(c2.data.id).toBe(c1.data.id);
    expect((await call('POST', '/api/memos', { requestId: hex(16), key, song: { ...song, duration: 99 } })).status).toBe(400);
  });

  it('保存・競合と、閲覧で比べる版（変更メモ・知らせない保存）', async () => {
    const { key, id, viewId } = await create();
    let v = await call('GET', `/api/view/${viewId}`);
    expect(v.data).toMatchObject({ version: 1, base: null });
    expect((await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song })).status).toBe(401);

    const save = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: renamed, note: '名前を付けた', notify: true }, { token: key });
    expect(save.data.version).toBe(2);
    const conflict = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: renamed }, { token: key });
    expect(conflict.status).toBe(409);
    expect(conflict.data.version).toBe(2);

    v = await call('GET', `/api/view/${viewId}`);
    expect(v.data.version).toBe(2);
    expect(v.data.song.sections[0].name).toBe('イントロ');
    expect(v.data.base.version).toBe(1);
    expect(v.data.base.song.sections[0].name).not.toBe('イントロ');
    expect(v.data.notes).toEqual([{ version: 2, note: '名前を付けた' }]);
    v = await call('GET', `/api/view/${viewId}?since=2`);
    expect(v.data).toMatchObject({ base: null, notify: false });

    await call('PUT', `/api/memos/${id}`, { baseVersion: 2, song: renamed, notify: false }, { token: key });
    v = await call('GET', `/api/view/${viewId}?since=2`);
    expect(v.data).toMatchObject({ version: 3, base: null, notify: false });
  });

  it('版は新しい10版だけ残し、端末の版が消えていたら残っている最も古い版と比べる', async () => {
    const { key, id, viewId } = await create();
    for (let n = 1; n <= 11; n++) await call('PUT', `/api/memos/${id}`, { baseVersion: n, song: n % 2 ? renamed : song }, { token: key });
    expect(db.prepare('SELECT min(version) v, count(*) n FROM memo_versions WHERE memo_id = ?').get(id)).toEqual({ v: 3, n: 10 });
    const v = await call('GET', `/api/view/${viewId}?since=1`);
    expect(v.data.version).toBe(12);
    expect(v.data.base.version).toBe(3);
  });

  it('編集キーは構成の取得・保存だけでき、作り直すと前の編集キーは使えない', async () => {
    const { key, id, viewId } = await create();
    const edit1 = await deriveEditKey(key, 1);
    const eget = await call('GET', `/api/memos/${id}`, undefined, { token: edit1 });
    expect(eget.data.role).toBe('edit');
    expect(eget.data.editKeyGen).toBeUndefined();
    expect((await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: renamed }, { token: edit1 })).status).toBe(200);
    for (const [m, p, b] of [['DELETE', '', undefined], ['POST', '/share', {}], ['POST', '/keys', { key: hex(24) }], ['POST', '/extend', {}]] as const) {
      expect((await call(m, `/api/memos/${id}${p}`, b, { token: edit1 })).status).toBe(403);
    }
    expect((await call('POST', `/api/view/${viewId}/open`, {}, { token: edit1 })).data).toEqual({ id, role: 'edit' });
    expect((await call('POST', `/api/view/${viewId}/open`, {}, { token: key })).data).toEqual({ id, role: 'admin' });
    expect((await call('POST', `/api/view/${viewId}/open`, {}, { token: hex(24) })).status).toBe(403);

    const rek = await call('POST', `/api/memos/${id}/edit-key`, {}, { token: key });
    expect(rek.data.editKeyGen).toBe(2);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: edit1 })).status).toBe(401);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: await deriveEditKey(key, 2) })).data.role).toBe('edit');

    const stop = await call('DELETE', `/api/memos/${id}/edit-key`, undefined, { token: key });
    expect(stop.data).toMatchObject({ editKey: false, editKeyGen: null });
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: await deriveEditKey(key, 2) })).status).toBe(401);
    expect((await call('POST', `/api/memos/${id}/edit-key`, {}, { token: key })).data.editKeyGen).toBe(4);
  });

  it('管理リンクを作り直すと、前の管理キーと、そこから導出した編集キーは使えない', async () => {
    const { key, id } = await create();
    await call('POST', `/api/memos/${id}/edit-key`, {}, { token: key });
    const next = hex(24);
    const rk = await call('POST', `/api/memos/${id}/keys`, { key: next }, { token: key });
    expect(rk.data.editKeyGen).toBe(2);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: key })).status).toBe(401);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: await deriveEditKey(key, 2) })).status).toBe(401);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: await deriveEditKey(next, 2) })).data.role).toBe('edit');
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: hex(24) })).status).toBe(401);
  });

  it('共有の作り直し・無効化、期限の延長、削除', async () => {
    const { key, id, viewId } = await create();
    const rs = await call('POST', `/api/memos/${id}/share`, {}, { token: key });
    expect((await call('GET', `/api/view/${viewId}`)).status).toBe(404);
    expect((await call('GET', `/api/view/${rs.data.viewId}`)).status).toBe(200);
    const un = await call('DELETE', `/api/memos/${id}/share`, undefined, { token: key });
    expect(un.data.viewId).toBeNull();
    expect((await call('GET', `/api/view/${rs.data.viewId}`)).status).toBe(404);

    db.prepare('UPDATE memos SET expires_at = ? WHERE id = ?').run(Date.now() + DAY, id);
    // 保持期限の延長は有料の機能にするので、管理キーでも断り、期限は変えない
    expect((await call('POST', `/api/memos/${id}/extend`, {}, { token: key })).status).toBe(403);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: key })).data.expiresAt).toBeLessThan(Date.now() + 2 * DAY);

    expect((await call('DELETE', `/api/memos/${id}`, undefined, { token: key })).status).toBe(204);
    expect((await call('GET', `/api/memos/${id}`, undefined, { token: key })).status).toBe(404);
    expect(db.prepare('SELECT count(*) n FROM memo_versions WHERE memo_id = ?').get(id)).toEqual({ n: 0 });
  });
});

describe('トップの一覧の状態', () => {
  it('正しいキーなら曲名と期限、違えば有無だけ。同じ曲メモが2つあっても両方返す', async () => {
    const a = await create(), b = await create();
    const st = await call('POST', '/api/memos/status', { items: [
      { id: a.id, key: a.key }, { id: a.id, key: a.key }, { id: b.id, key: hex(24) }, { id: 'x' }, { id: '0'.repeat(24) },
    ] });
    expect(st.data.items).toHaveLength(4);
    expect(st.data.items[0]).toMatchObject({ id: a.id, title: 'テスト', viewId: a.viewId });
    expect(st.data.items[1]).toMatchObject({ id: a.id, title: 'テスト' });
    expect(st.data.items[2]).toEqual({ id: b.id });
    expect(st.data.items[3]).toEqual({ id: '0'.repeat(24), gone: true });
  });

  it('期限切れは見つからないとし、51件以上は拒否する', async () => {
    const a = await create();
    db.prepare('UPDATE memos SET expires_at = 1 WHERE id = ?').run(a.id);
    expect((await call('POST', '/api/memos/status', { items: [{ id: a.id, key: a.key }] })).data.items).toEqual([{ id: a.id, gone: true }]);
    expect((await call('POST', '/api/memos/status', { items: [] })).data.items).toEqual([]);
    expect((await call('POST', '/api/memos/status', { items: Array.from({ length: 51 }, () => ({ id: a.id })) })).status).toBe(400);
  });
});

describe('マイキー', () => {
  it('作成・取得・更新・削除。同時の更新は409、削除後は410で作り直さない', async () => {
    const my = hex(24);
    const ac = (method: string, body?: unknown, token = my) => call(method, '/api/account', body, { token });
    expect((await ac('GET')).status).toBe(404);
    expect((await ac('GET', undefined, 'xyz')).status).toBe(403);
    expect((await ac('PUT', { data: 'QUJD', revision: 1 })).status).toBe(409);
    expect((await ac('PUT', { data: 'not base64!', revision: 0 })).status).toBe(400);
    expect((await ac('PUT', { data: 'QUJD', revision: 0 })).data.revision).toBe(1);
    expect((await ac('GET')).data).toEqual({ data: 'QUJD', revision: 1 });
    expect((await ac('PUT', { data: 'REVG', revision: 0 })).status).toBe(409);
    expect((await ac('PUT', { data: 'REVG', revision: 1 })).data.revision).toBe(2);
    expect((await ac('GET', undefined, hex(24))).status).toBe(404);
    expect((await ac('DELETE')).data).toEqual({ deleted: true });
    expect((await ac('GET')).status).toBe(410);
    expect((await ac('PUT', { data: 'QUJD', revision: 0 })).status).toBe(410);
  });
});

describe('YouTube の検索', () => {
  // Google の偽物。searches は検索（100ユニット）の回数
  let searches = 0;
  function google(fail?: { status: number; reason: string }) {
    searches = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/search?')) searches++;
      if (fail) return new Response(JSON.stringify({ error: { errors: [{ reason: fail.reason }], message: fail.reason } }), { status: fail.status });
      const body = url.includes('/search?')
        ? { items: [{ id: { videoId: 'HEkWqvM6tQ8' }, snippet: { title: '曲', channelTitle: 'ch' } }] }
        : { items: [{ id: 'HEkWqvM6tQ8', contentDetails: { duration: 'PT4M42S' } }] };
      return new Response(JSON.stringify(body));
    });
  }
  const search = (title: string, ip?: string) => call('GET', `/api/youtube?${new URLSearchParams({ title })}`, undefined, { ip });

  it('API キーがなければ使えないことだけを返す', async () => {
    google();
    expect((await search('曲')).data).toEqual({ videos: [], available: false });
    expect(searches).toBe(0);
  });

  it('結果はキャッシュし、同じ曲では Google に問い合わせない', async () => {
    env.YOUTUBE_API_KEY = 'KEY';
    google();
    const r = await search('曲');
    expect(r.data).toEqual({ videos: [{ id: 'HEkWqvM6tQ8', title: '曲', channel: 'ch', seconds: 282 }], available: true });
    expect((await search('曲')).data).toEqual(r.data);
    expect(searches).toBe(1);
  });

  it('同じ IP からは1時間 30 回まで', async () => {
    env.YOUTUBE_API_KEY = 'KEY';
    google();
    for (let n = 0; n < 30; n++) expect((await search(`曲${n}`)).status).toBe(200);
    expect((await search('曲30')).status).toBe(429);
  });

  it('サービス全体で1日 90 回を超えたら、Google に問い合わせず上限に達したことを返す', async () => {
    env.YOUTUBE_API_KEY = 'KEY';
    google();
    for (let n = 0; n < 90; n++) expect((await search(`曲${n}`, `192.0.2.${n}`)).data.available).toBe(true);
    expect((await search('曲90', '198.51.100.1')).data).toEqual({ videos: [], available: false, limited: true });
    expect(searches).toBe(90);
    // キャッシュにある曲は上限のあとも出る
    expect((await search('曲0', '198.51.100.2')).data.available).toBe(true);
  });

  it('Google が枠切れを返したら、その日はもう問い合わせない', async () => {
    env.YOUTUBE_API_KEY = 'KEY';
    google({ status: 403, reason: 'quotaExceeded' });
    expect((await search('曲a')).data).toEqual({ videos: [], available: false, limited: true });
    expect((await search('曲b')).data).toEqual({ videos: [], available: false, limited: true });
    expect(searches).toBe(1);
  });

  it('枠切れ以外の失敗は 502 で、次の検索ではまた問い合わせる', async () => {
    env.YOUTUBE_API_KEY = 'KEY';
    google({ status: 400, reason: 'keyInvalid' });
    expect((await search('曲a')).status).toBe(502);
    expect((await search('曲b')).status).toBe(502);
    expect(searches).toBe(2);
  });
});

describe('利用イベント', () => {
  it('決まった種類だけ記録する', async () => {
    expect((await call('POST', '/api/events', { kind: 'analysis_ok', anon: 'x', durationMs: 800, audioSec: 273 })).status).toBe(204);
    expect((await call('POST', '/api/events', { kind: 'other' })).status).toBe(400);
    expect(db.prepare('SELECT kind, duration_ms FROM usage_events').all()).toEqual([{ kind: 'analysis_ok', duration_ms: 800 }]);
  });
});

describe('定期の削除', () => {
  it('期限切れの曲メモと版、マイキー、古い利用イベント、回数制限を消し、ほかは残す', async () => {
    const keep = await create(), gone = await create();
    await call('PUT', `/api/memos/${gone.id}`, { baseVersion: 1, song: renamed }, { token: gone.key });
    db.prepare('UPDATE memos SET expires_at = 1 WHERE id = ?').run(gone.id);
    const now = Date.now();
    db.prepare("INSERT INTO accounts (id, data, revision, deleted, updated_at, expires_at) VALUES ('old', NULL, 1, 1, 0, 1), ('new', 'QUJD', 1, 0, ?, ?)").run(now, now + DAY);
    db.prepare("INSERT INTO usage_events (kind, at) VALUES ('analysis_ok', ?), ('analysis_ok', ?)").run(now - 91 * DAY, now);
    db.prepare("INSERT INTO rate_limits (bucket, count, expires_at) VALUES ('old', 1, 1), ('new', 1, ?)").run(now + DAY);

    await worker.scheduled({} as ScheduledController, env);

    const ids = (sql: string) => db.prepare(sql).all().map((r) => Object.values(r)[0]);
    expect(ids('SELECT id FROM memos')).toEqual([keep.id]);
    expect(ids('SELECT DISTINCT memo_id FROM memo_versions')).toEqual([keep.id]);
    expect(ids('SELECT id FROM accounts')).toEqual(['new']);
    expect(ids('SELECT at FROM usage_events')).toEqual([now]);
    expect(ids("SELECT bucket FROM rate_limits WHERE bucket IN ('old', 'new')")).toEqual(['new']);
  });
});
