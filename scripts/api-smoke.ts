// 開発用：ローカルの API（wrangler dev）に対して主要な操作を順に確認する
import { deriveEditKey } from '../shared/keys.ts';
import { emptySong, newSection, normalize } from '../shared/song.ts';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:5173'; // .dev.vars の ALLOWED_ORIGINS にある画面のドメイン
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
const editKey = await deriveEditKey(key, 1);

const c1 = await call('POST', '/api/memos', { requestId, key, song });
check('作成（編集キーは管理キーから導出）', c1.status === 201 && c1.data.editKey === true && c1.data.editKeyGen === 1, c1);
const c2 = await call('POST', '/api/memos', { requestId, key, song });
check('同じ作成リクエストの再送は同じ曲メモ', c2.status === 200 && c2.data.id === c1.data.id, c2);
const { id, viewId } = c1.data;
let admin = key;

const bad = await call('POST', '/api/memos', { requestId: hex(16), key, song: { ...song, duration: 99 } });
check('不正な構成データは拒否', bad.status === 400, bad);

let v = await call('GET', `/api/view/${viewId}`);
check('閲覧（初版は差分なし）', v.status === 200 && v.data.version === 1 && v.data.base === null, v);
const anonEdit = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song });
check('閲覧URLだけでは編集できない', anonEdit.status === 401, anonEdit);

const s2 = { ...song, sections: [{ ...song.sections[0], name: 'イントロ', nameAuto: false }, song.sections[1]] };
const save = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: s2, note: '名前を付けた', notify: true }, admin);
check('保存', save.status === 200 && save.data.version === 2, save);
const conflict = await call('PUT', `/api/memos/${id}`, { baseVersion: 1, song: s2 }, admin);
check('古い版からの保存は競合', conflict.status === 409 && conflict.data.version === 2, conflict);

v = await call('GET', `/api/view/${viewId}`);
check('閲覧（直前の版と差分）', v.data.version === 2 && v.data.base?.version === 1 && v.data.notes[0]?.note === '名前を付けた', v);
v = await call('GET', `/api/view/${viewId}?since=2`);
check('閲覧（最新を見た端末は差分なし）', v.data.base === null && v.data.notify === false, v);

const quiet = await call('PUT', `/api/memos/${id}`, { baseVersion: 2, song: s2, notify: false }, admin);
v = await call('GET', `/api/view/${viewId}?since=2`);
check('知らせない保存では更新案内なし', quiet.status === 200 && v.data.version === 3 && v.data.notify === false && v.data.base === null, v);

// 編集キー：構成の保存はできるが、管理の操作はできない。世代は返さない
const eget = await call('GET', `/api/memos/${id}`, undefined, editKey);
check('編集キーで構成を取得できる', eget.status === 200 && eget.data.role === 'edit' && eget.data.editKeyGen === undefined, eget);
const esave = await call('PUT', `/api/memos/${id}`, { baseVersion: eget.data.version, song: s2, notify: false }, editKey);
check('編集キーで保存できる', esave.status === 200, esave);
const edel = await call('DELETE', `/api/memos/${id}`, undefined, editKey);
const eshare = await call('POST', `/api/memos/${id}/share`, {}, editKey);
const ekeys = await call('POST', `/api/memos/${id}/keys`, { key: hex(24) }, editKey);
check('編集キーでは削除・共有・キー再発行ができない', edel.status === 403 && eshare.status === 403 && ekeys.status === 403, { edel, eshare, ekeys });
const eview = await call('POST', `/api/view/${viewId}/open`, {}, editKey);
check('閲覧識別子＋編集キーで曲メモが分かる', eview.status === 200 && eview.data.id === id && eview.data.role === 'edit', eview);
const aview = await call('POST', `/api/view/${viewId}/open`, {}, key);
check('閲覧識別子＋管理キーでも分かる', aview.status === 200 && aview.data.role === 'admin', aview);
const badview = await call('POST', `/api/view/${viewId}/open`, {}, hex(24));
check('閲覧識別子＋誤ったキーは拒否', badview.status === 403, badview);
const rek = await call('POST', `/api/memos/${id}/edit-key`, {}, admin);
const newEdit = await deriveEditKey(key, 2);
const oldEdit = await call('GET', `/api/memos/${id}`, undefined, editKey);
const newEget = await call('GET', `/api/memos/${id}`, undefined, newEdit);
check('編集リンクの作り直しで、旧編集キーは無効・次の世代の編集キーは有効', rek.status === 200 && rek.data.editKeyGen === 2 && oldEdit.status === 401 && newEget.data?.role === 'edit', { rek, oldEdit, newEget });
const stop = await call('DELETE', `/api/memos/${id}/edit-key`, undefined, admin);
const afterStop = await call('GET', `/api/memos/${id}`, undefined, newEdit);
check('メンバーの編集を止めると、編集キーは使えない', stop.status === 200 && stop.data.editKey === false && stop.data.editKeyGen === null && afterStop.status === 401, { stop, afterStop });
const resume = await call('POST', `/api/memos/${id}/edit-key`, {}, admin);
check('止めたあとで作り直すと次の世代', resume.status === 200 && resume.data.editKeyGen === 4, resume);

const wrong = await call('GET', `/api/memos/${id}`, undefined, hex(24));
check('誤ったキーは拒否', wrong.status === 401, wrong);

const newKey = hex(24);
const rk = await call('POST', `/api/memos/${id}/keys`, { key: newKey }, admin);
check('管理リンクの作り直し（編集リンクも変わる）', rk.status === 200 && rk.data.editKeyGen === 4, rk);
const oldKey = await call('GET', `/api/memos/${id}`, undefined, key);
const oldEdit4 = await call('GET', `/api/memos/${id}`, undefined, await deriveEditKey(key, 4));
const newEdit4 = await call('GET', `/api/memos/${id}`, undefined, await deriveEditKey(newKey, 4));
check('作り直し後、旧管理キー・旧編集キーは無効、新しい管理キーから導出した編集キーは有効', oldKey.status === 401 && oldEdit4.status === 401 && newEdit4.data?.role === 'edit', { oldKey, oldEdit4, newEdit4 });
admin = newKey;

const rs = await call('POST', `/api/memos/${id}/share`, {}, admin);
const oldView = await call('GET', `/api/view/${viewId}`);
const newView = await call('GET', `/api/view/${rs.data.viewId}`);
check('共有URL再発行で旧URLは無効', oldView.status === 404 && newView.status === 200, { oldView, newView });
const un = await call('DELETE', `/api/memos/${id}/share`, undefined, admin);
check('共有の無効化', un.status === 200 && un.data.viewId === null && (await call('GET', `/api/view/${rs.data.viewId}`)).status === 404, un);

const ext = await call('POST', `/api/memos/${id}/extend`, {}, admin);
check('保持期限の更新', ext.status === 200 && ext.data.expiresAt > Date.now() + 179 * 864e5, ext);
const ev = await call('POST', '/api/events', { kind: 'analysis_ok', anon: 'x', durationMs: 800, audioSec: 273 });
check('利用イベント', ev.status === 204, ev);
// トップの一覧：正しいキーがあれば曲名と期限、なければ有無だけ
let st = await call('POST', '/api/memos/status', { items: [{ id, key: admin }, { id, key: hex(24) }, { id: 'x' }] });
check('一覧の状態（正しいキーは曲名、違えば有無だけ）', st.status === 200 && st.data.items.length === 2
  && st.data.items[0].title === 'テスト' && st.data.items[0].expiresAt > Date.now() && st.data.items[1].title === undefined && !st.data.items[1].gone, st);
const del = await call('DELETE', `/api/memos/${id}`, undefined, admin);
const after = await call('GET', `/api/memos/${id}`, undefined, admin);
check('削除後はアクセスできない', del.status === 204 && after.status === 404, after);
st = await call('POST', '/api/memos/status', { items: [{ id, key: admin }] });
check('削除後は一覧の状態が見つからない', st.status === 200 && st.data.items[0]?.gone === true, st);
const tooMany = await call('POST', '/api/memos/status', { items: Array.from({ length: 51 }, () => ({ id })) });
check('一覧の状態は51件以上を拒否', tooMany.status === 400, tooMany);

// マイキー：照合用キーで暗号化済みの一覧を保存・取得。同時更新は409、削除後は410で作り直さない
const my = hex(24);
const ac = (method: string, body?: unknown, t = my) => call(method, '/api/account', body, t);
check('マイキー：未作成は404・形式違いは403', (await ac('GET')).status === 404 && (await ac('GET', undefined, 'xyz')).status === 403);
check('マイキー：未作成なのに revision 指定は409', (await ac('PUT', { data: 'QUJD', revision: 1 })).status === 409);
check('マイキー：base64 以外は400', (await ac('PUT', { data: 'not base64!', revision: 0 })).status === 400);
const a1 = await ac('PUT', { data: 'QUJD', revision: 0 });
check('マイキー：作成', a1.status === 200 && a1.data.revision === 1, a1);
const a2 = await ac('GET');
check('マイキー：取得', a2.data?.data === 'QUJD' && a2.data.revision === 1, a2);
check('マイキー：古い revision は409', (await ac('PUT', { data: 'REVG', revision: 0 })).status === 409);
check('マイキー：更新', (await ac('PUT', { data: 'REVG', revision: 1 })).data?.revision === 2);
check('マイキー：別のキーでは読めない', (await ac('GET', undefined, hex(24))).status === 404);
check('マイキー：削除', (await ac('DELETE')).data?.deleted === true);
check('マイキー：削除後は410で作り直さない', (await ac('GET')).status === 410 && (await ac('PUT', { data: 'QUJD', revision: 0 })).status === 410);

const noOrigin = await fetch(`${BASE}/api/bpm?title=x`);
const otherOrigin = await fetch(`${BASE}/api/bpm?title=x`, { headers: { Origin: 'https://example.com' } });
check('許可していないサイト・Origin なしは拒否', noOrigin.status === 403 && otherOrigin.status === 403, { noOrigin: noOrigin.status, otherOrigin: otherOrigin.status });

process.exit(failed ? 1 : 0);
