// ブラウザ内にだけ保存するデータ（要件定義書 8章）。保存できない環境でも動作を続ける
import type { Song } from '../../../shared/song';

const DB = 'kyoku-shiori';
const STORE = 'drafts';
export const DRAFT_DAYS = 30;

// create は初回保存の再送用（同じリクエストIDと秘密キーで再送すると同じ曲メモになる）
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
    return await new Promise<T>((res, rej) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
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

// 編集セッション：記憶を選ばなかった場合は、タブを閉じると消える sessionStorage に置く
export function getSession(id: string): string | null {
  try { return sessionStorage.getItem(`ks-session-${id}`) ?? get(`ks-session-${id}`); } catch { return get(`ks-session-${id}`); }
}
export function setSession(id: string, token: string | null, remember: boolean) {
  set(`ks-session-${id}`, remember ? token : null);
  try {
    if (token && !remember) sessionStorage.setItem(`ks-session-${id}`, token);
    else sessionStorage.removeItem(`ks-session-${id}`);
  } catch { /* 保存不可 */ }
}

export const getSeen = (viewId: string) => Number(get(`ks-seen-${viewId}`)) || null;
export const setSeen = (viewId: string, version: number) => set(`ks-seen-${viewId}`, String(version));

export type MineEntry = { id: string; title: string; updatedAt: number };
export function listMine(): MineEntry[] {
  try { return JSON.parse(get('ks-mine') ?? '[]'); } catch { return []; }
}
export function rememberMine(e: MineEntry) {
  set('ks-mine', JSON.stringify([e, ...listMine().filter((x) => x.id !== e.id)].slice(0, 50)));
}
export function forgetMine(id: string) {
  set('ks-mine', JSON.stringify(listMine().filter((x) => x.id !== id)));
}

// 匿名識別子（利用者数の推定用。個人は特定しない）
export function anonId(): string {
  let v = get('ks-anon');
  if (!v) { v = crypto.randomUUID(); set('ks-anon', v); }
  return v;
}
