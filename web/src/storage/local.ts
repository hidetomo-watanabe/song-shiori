import type { CountMode } from '../../../shared/song';
// ブラウザ内にだけ保存するデータ（要件定義書 8章）。保存できない環境でも動作を続ける
import type { Song } from '../../../shared/song';

const DB = 'song-shiori';
const STORE = 'drafts';
export const DRAFT_DAYS = 30;

// create は初回保存の再送用（同じリクエストIDと管理キーで再送すると同じ曲メモになる）
export type DraftRecord = { song: Song; updatedAt: number; baseVersion?: number; create?: { requestId: string; key: string } };

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    try {
      return await new Promise<T>((res, rej) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
    } finally {
      db.close(); // 開いたままにすると接続がたまり、データの削除なども妨げる
    }
  } catch {
    return undefined;
  }
}

// key は 'draft'（未保存の新規）または 'pending:{曲メモID}'（保存済みメモの未送信の変更）
export async function loadDraft(key: string): Promise<DraftRecord | null> {
  const rec = await tx<DraftRecord>('readonly', (s) => s.get(key));
  if (!rec) return null;
  if (Date.now() - rec.updatedAt > DRAFT_DAYS * 864e5) {
    await removeDraft(key);
    return null;
  }
  return rec;
}

export const saveDraft = (key: string, rec: DraftRecord) => tx('readwrite', (s) => s.put(rec, key));
export const removeDraft = (key: string) => tx('readwrite', (s) => s.delete(key));

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => {
  try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 保存不可 */ }
};

// メトロノームの音量（0〜1）。保存していなければ null
export const getMetronomeVolume = () => {
  const v = get('ks-metronome-volume');
  return v != null && Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : null;
};
export const setMetronomeVolume = (v: number) => set('ks-metronome-volume', String(v));

// 再生の前のカウントの設定（0・1・2 小節、intro：イントロ前の間だけメトロノーム）。保存していなければ 0（鳴らさない）
export const getCountIn = (): CountMode => {
  const v = get('ks-count-in');
  return v === 'intro' ? 'intro' : v === '1' ? 1 : v === '2' ? 2 : 0;
};
export const setCountIn = (v: CountMode) => set('ks-count-in', v ? String(v) : null);

export const getSeen = (viewId: string) => Number(get(`ks-seen-${viewId}`)) || null;
export const setSeen = (viewId: string, version: number) => set(`ks-seen-${viewId}`, String(version));

// viewId は閲覧ページから編集画面へ移るため（このブラウザにキーがあれば「編集する」をリンクにする）
export type MineEntry = { id: string; title: string; updatedAt: number; viewId?: string | null };
export function listMine(): MineEntry[] {
  try { return JSON.parse(get('ks-mine') ?? '[]'); } catch { return []; }
}
export function rememberMine(e: MineEntry) {
  set('ks-mine', JSON.stringify([e, ...listMine().filter((x) => x.id !== e.id)].slice(0, 50)));
}
// サーバーで確かめた曲名・更新日時を一覧に反映する（並び順は変えない）。
// マイキーの同期で取り込んだなど、一覧にまだない曲メモは更新日時の順に後ろへ足す
export function updateMine(patch: Map<string, Omit<MineEntry, 'id'>>) {
  const list = listMine();
  const known = new Set(list.map((x) => x.id));
  const added = [...patch].filter(([id]) => !known.has(id)).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.updatedAt - a.updatedAt);
  set('ks-mine', JSON.stringify([...list.map((x) => ({ ...x, ...patch.get(x.id) })), ...added].slice(0, 50)));
}
export function forgetMine(id: string) {
  set('ks-mine', JSON.stringify(listMine().filter((x) => x.id !== id)));
}

// リンクのキー（ライブのしおりと同じ）：曲メモごとに、開いたリンクのキー（管理キーか編集キー）を1つ保存する。
// 管理キーがあれば編集キーは導出できるので、管理キーを優先して残す。マイキーを使っていれば、変わったときに同期する
export const KEY_PREFIX = 'ks-key-';
export const isKeyName = (k: string) => /^ks-key-[a-f0-9]{24}$/.test(k);
export const getKey = (id: string) => get(KEY_PREFIX + id);
let keysChanged: () => void = () => {};
export const onKeysChanged = (fn: () => void) => { keysChanged = fn; };
export function setKey(id: string, key: string | null) {
  if ((key ?? null) === getKey(id)) return;
  set(KEY_PREFIX + id, key);
  keysChanged();
}
// このブラウザにあるリンクのキー：{保存名: キー}
export function linkKeys(): Record<string, string> {
  const o: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (isKeyName(k)) o[k] = localStorage.getItem(k)!;
    }
  } catch { /* 保存不可 */ }
  return o;
}
export const keyIds = () => Object.keys(linkKeys()).map((k) => k.slice(KEY_PREFIX.length));

// 以前の形式（編集セッションと、記憶を選んだときのキーの控え ks-keys-）を、リンクのキーに移す
(function migrate() {
  try {
    for (const k of Object.keys(localStorage)) {
      const m = k.match(/^ks-keys-([a-f0-9]{24})$/);
      if (m && !getKey(m[1])) {
        try { const o = JSON.parse(localStorage.getItem(k)!); if (o.admin || o.edit) set(KEY_PREFIX + m[1], o.admin ?? o.edit); } catch { /* 読めない控えは捨てる */ }
      }
      if (m || k.startsWith('ks-session-')) localStorage.removeItem(k);
    }
    for (const k of Object.keys(sessionStorage)) if (k.startsWith('ks-session-')) sessionStorage.removeItem(k);
  } catch { /* 保存不可 */ }
})();

// マイキー（#/mine で設定）と、前回同期した一覧
export const getMyKey = () => get('ks-mykey');
export const getMyBase = (): Record<string, string> => { try { return JSON.parse(get('ks-mykey-base') ?? '{}') ?? {}; } catch { return {}; } };
export const setMyBase = (o: Record<string, string> | null) => set('ks-mykey-base', o ? JSON.stringify(o) : null);
// マイキーを変えたら、前回同期した一覧は別のマイキーのものなので捨てる
export function setMyKey(v: string | null) {
  if (v !== getMyKey()) setMyBase(null);
  set('ks-mykey', v);
}
// 同期で取り込んだ一覧をこのブラウザに反映する（同期は起こさない）
export function replaceKeys(next: Record<string, string>) {
  for (const k of Object.keys(linkKeys())) if (!next[k]) set(k, null);
  for (const [k, v] of Object.entries(next)) set(k, v);
}

// 匿名識別子（利用者数の推定用。個人は特定しない）
export function anonId(): string {
  let v = get('ks-anon');
  if (!v) { v = crypto.randomUUID(); set('ks-anon', v); }
  return v;
}
