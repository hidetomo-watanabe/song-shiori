// 開発用：ローカルの API（wrangler dev）に対して主要な操作を順に確認する
import { emptySong, newSection, normalize } from '../shared/song.ts';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}
let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'NG '} ${label}${ok ? '' : ' ' + JSON.stringify(detail)}`);
};

const song = normalize({ ...emptySong(32), title: 'テスト', bpmManual: 120, sections: [newSection(0, 16, { group: 'A' }), newSection(16, 32, { group: 'B' })] });
const key = hex(24), requestId = hex(16);

const c1 = await call('POST', '/api/memos', { requestId, key, song });
check('作成', c1.status === 201, c1);
const c2 = await call('POST', '/api/memos', { requestId, key, song });
check('同じ作成リクエストの再送は同じ曲メモ', c2.status === 200 && c2.data.id === c1.data.id, c2);
const { id, viewId } = c1.data;
let session = c1.data.session;

const bad = await call('POST', '/api/memos', { requestId: hex(16), key, song: { ...song, duration: 99 } });
check('不正な構成データは拒否', bad.status === 400, bad);

let v = await call('GET', `/api/view/${viewId}`);
check('閲覧（初版は差分なし）', v.status === 200 && v.data.version === 1 && v.data.base === null, v);
const anonEdit = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song });
check('閲覧URLだけでは編集できない', anonEdit.status === 401, anonEdit);

const s2 = { ...song, sections: [{ ...song.sections[0], name: 'イントロ', nameAuto: false }, song.sections[1]] };
const save = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: s2, note: '名前を付けた', notify: true }, session);
check('保存', save.status === 200 && save.data.version === 2, save);
const conflict = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: s2 }, session);
check('古い版からの保存は競合', conflict.status === 409 && conflict.data.version === 2, conflict);

v = await call('GET', `/api/view/${viewId}`);
check('閲覧（直前の版と差分）', v.data.version === 2 && v.data.base?.version === 1 && v.data.notes[0]?.note === '名前を付けた', v);
v = await call('GET', `/api/view/${viewId}?since=2`);
check('閲覧（最新を見た端末は差分なし）', v.data.base === null && v.data.notify === false, v);

const quiet = await call('PUT', `/api/memos/${id}`, { baseVersion: 2, song: s2, notify: false }, session);
v = await call('GET', `/api/view/${viewId}?since=2`);
check('知らせない保存では更新案内なし', quiet.status === 200 && v.data.version === 3 && v.data.notify === false && v.data.base === null, v);

const wrong = await call('POST', `/api/memos/${id}/session`, {}, hex(24));
check('誤った秘密キーは拒否', wrong.status === 403, wrong);
const sess = await call('POST', `/api/memos/${id}/session`, {}, key);
check('秘密キーで編集セッション発行', sess.status === 200 && typeof sess.data.session === 'string', sess);

const newKey = hex(24);
const rk = await call('POST', `/api/memos/${id}/keys`, { key: newKey }, session);
check('キー再発行', rk.status === 200, rk);
const oldSess = await call('GET', `/api/memos/${id}`, undefined, sess.data.session);
check('再発行後、旧セッションは無効', oldSess.status === 401, oldSess);
const oldKey = await call('POST', `/api/memos/${id}/session`, {}, key);
check('再発行後、旧キーは無効', oldKey.status === 403, oldKey);
session = rk.data.session;

const rs = await call('POST', `/api/memos/${id}/share`, {}, session);
const oldView = await call('GET', `/api/view/${viewId}`);
const newView = await call('GET', `/api/view/${rs.data.viewId}`);
check('共有URL再発行で旧URLは無効', oldView.status === 404 && newView.status === 200, { oldView, newView });
const un = await call('DELETE', `/api/memos/${id}/share`, undefined, session);
check('共有の無効化', un.status === 200 && un.data.viewId === null && (await call('GET', `/api/view/${rs.data.viewId}`)).status === 404, un);

const ext = await call('POST', `/api/memos/${id}/extend`, {}, session);
check('保持期限の更新', ext.status === 200 && ext.data.expiresAt > Date.now() + 179 * 864e5, ext);
const ev = await call('POST', '/api/events', { kind: 'analysis_ok', anon: 'x', durationMs: 800, audioSec: 273 });
check('利用イベント', ev.status === 204, ev);
const del = await call('DELETE', `/api/memos/${id}`, undefined, session);
const after = await call('GET', `/api/memos/${id}`, undefined, session);
check('削除後はアクセスできない', del.status === 204 && after.status === 404, after);

process.exit(failed ? 1 : 0);
