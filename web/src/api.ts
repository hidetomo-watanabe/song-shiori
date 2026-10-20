// API の呼び出し。秘密キーと編集セッションは Authorization ヘッダーで送る
import type { Song } from '../../shared/song';
import { anonId } from './storage/local';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: any = null) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('通信できませんでした。接続を確認して再試行してください', 0);
  }
  const data: any = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? `エラーが発生しました（${res.status}）`, res.status, data);
  return data as T;
}

export const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

// role：admin は管理キー（作成者。すべての操作）、edit は編集キー（メンバー。構成の編集と保存だけ）
export type Role = 'admin' | 'edit';
export type MemoInfo = { id: string; viewId: string | null; version: number; updatedAt: number; expiresAt: number; editKey: boolean };
export type Created = MemoInfo & { session: string; role: Role };
export type EditData = MemoInfo & { song: Song; role: Role };
export type ViewData = {
  version: number; updatedAt: number; expiresAt: number; song: Song;
  base: { version: number; song: Song } | null; notify: boolean; notes: { version: number; note: string }[];
};

export type BpmCandidate = { source: 'GetSongBPM' | 'Deezer'; title: string; artist: string; bpm: number; url: string | null };

export const api = {
  // キー（管理キー・編集キー）は端末で作り、サーバーにはハッシュだけを保存する。再送しても同じ曲メモになる
  create: (requestId: string, key: string, editKey: string, song: Song) => call<Created>('POST', '/api/memos', { requestId, key, editKey, song }),
  view: (viewId: string, since: number | null) => call<ViewData>('GET', `/api/view/${viewId}${since ? `?since=${since}` : ''}`),
  session: (id: string, key: string) => call<{ session: string; role: Role }>('POST', `/api/memos/${id}/session`, {}, key),
  // 閲覧ページから編集を始める（閲覧識別子と、編集キーまたは管理キー）
  viewSession: (viewId: string, key: string) => call<{ id: string; session: string; role: Role }>('POST', `/api/view/${viewId}/session`, {}, key),
  get: (id: string, s: string) => call<EditData>('GET', `/api/memos/${id}`, undefined, s),
  save: (id: string, s: string, baseVersion: number, song: Song, note: string, notify: boolean) =>
    call<MemoInfo>('PUT', `/api/memos/${id}`, { baseVersion, song, note, notify }, s),
  rekey: (id: string, s: string, key: string) => call<{ session: string }>('POST', `/api/memos/${id}/keys`, { key }, s),
  editKey: (id: string, s: string, key: string) => call<MemoInfo>('POST', `/api/memos/${id}/edit-key`, { key }, s),
  stopEdit: (id: string, s: string) => call<MemoInfo>('DELETE', `/api/memos/${id}/edit-key`, undefined, s),
  reshare: (id: string, s: string) => call<MemoInfo>('POST', `/api/memos/${id}/share`, {}, s),
  unshare: (id: string, s: string) => call<MemoInfo>('DELETE', `/api/memos/${id}/share`, undefined, s),
  extend: (id: string, s: string) => call<MemoInfo>('POST', `/api/memos/${id}/extend`, {}, s),
  remove: (id: string, s: string) => call<null>('DELETE', `/api/memos/${id}`, undefined, s),
  // 曲名・アーティスト名でネット上の BPM 情報を調べる（音源は送らない）
  bpm: (title: string, artist: string) =>
    call<{ candidates: BpmCandidate[]; sources: string[] }>('GET', `/api/bpm?${new URLSearchParams({ title, artist })}`),
};

// 利用イベント（内容を含まない）。失敗しても無視する
export function track(kind: string, extra: { durationMs?: number; error?: string; audioSec?: number } = {}) {
  const device = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  void call('POST', '/api/events', { kind, anon: anonId(), device, ...extra }).catch(() => {});
}
