// マイキー（#/mine で設定。ライブのしおりと同じ）：このブラウザにあるリンクのキーの一覧を、マイキーから作った鍵で暗号化してサーバーに置き、
// 同じマイキーの端末どうしで揃える。前回同期した一覧と比べ、このブラウザで変わった分（追加・削除・作り直し）はこちらを、変わっていない分はサーバー側を採る
import { sha256 } from '../../../shared/keys';
import { api, ApiError } from '../api';
import * as L from './local';

// サーバーには、マイキーそのものではなく照合用の値（マイキーから導出）だけを送る
const accountAuth = async (my: string) => (await sha256(`${my}:account`)).slice(0, 48);
const aesKey = async (my: string) =>
  crypto.subtle.importKey('raw', Uint8Array.from((await sha256(`${my}:enc`)).match(/../g)!, (h) => parseInt(h, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function seal(key: CryptoKey, o: Record<string, string>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(o))));
  return btoa(String.fromCharCode(...iv, ...ct));
}
async function unseal(key: CryptoKey, s: string): Promise<Record<string, string>> {
  try {
    const b = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const o = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12))));
    return Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => L.isKeyName(k) && typeof v === 'string' && /^[a-f0-9]{48}$/.test(v))) as Record<string, string>;
  } catch {
    throw new Error('マイキーの一覧を読み込めませんでした');
  }
}

const same = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

export const isMyKey = (s: string) => /^[a-f0-9]{48}$/.test(s);
export const myKeyUrl = (my: string) => `${location.origin}${location.pathname}#/mine?k=${my}`;
export const newMyKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

// 打ち間違いで新しいマイキーができないよう、ほかの端末のマイキーを使うときはサーバーにあるかを確かめる
export async function myKeyExists(my: string) {
  try { await api.account(await accountAuth(my)); return true; } catch (e) { if (e instanceof ApiError && e.status === 404) return false; throw e; }
}

export async function deleteMyKey() {
  const my = L.getMyKey();
  if (!my) return;
  try { await api.deleteAccount(await accountAuth(my)); } catch (e) { if (!(e instanceof ApiError && (e.status === 404 || e.status === 410))) throw e; }
  L.setMyKey(null);
}

async function syncOnce(): Promise<number | null> {
  const my = L.getMyKey();
  if (!my || !isMyKey(my)) return null;
  const auth = await accountAuth(my);
  const key = await aesKey(my);
  for (let n = 0; n < 3; n++) {
    // 別の端末でマイキーが削除されていたら、この端末でも使うのをやめる（各リンクのキーは残す）
    let remote: Record<string, string> = {};
    let revision = 0;
    try {
      const r = await api.account(auth);
      remote = await unseal(key, r.data);
      revision = r.revision;
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) { L.setMyKey(null); return null; }
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
    const base = L.getMyBase();
    const local = L.linkKeys();
    const next: Record<string, string> = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const v = local[k] !== base[k] ? local[k] : remote[k];
      if (v) next[k] = v;
    }
    if (!revision || !same(next, remote)) {
      try {
        await api.putAccount(auth, await seal(key, next), revision);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) continue;
        if (e instanceof ApiError && e.status === 410) { L.setMyKey(null); return null; }
        throw e;
      }
    }
    L.replaceKeys(next);
    L.setMyBase(next);
    return Object.keys(next).length;
  }
  throw new Error('同期が混み合っています。時間をおいて再度お試しください');
}

// 同期は1つずつ順に行う。まだ始まっていない同期があればそれにまとめる。戻り値は同期後のキーの数（マイキー未設定なら null）
let syncing: Promise<unknown> = Promise.resolve();
let queued: Promise<number | null> | null = null;
export function syncKeys(): Promise<number | null> {
  if (queued) return queued;
  const p = syncing.catch(() => {}).then(() => { queued = null; return syncOnce(); });
  queued = p;
  syncing = p;
  return p;
}

// リンクのキーが変わったら、マイキーを設定している場合は同期する
L.onKeysChanged(() => { if (L.getMyKey()) syncKeys().catch(() => {}); });
