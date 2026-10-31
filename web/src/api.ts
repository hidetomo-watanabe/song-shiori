// API の呼び出し。リンクのキー（管理キー・編集キー）とマイキーの照合用キーは Authorization ヘッダーで送る
import type { Song } from '../../shared/song';
import { anonId } from './storage/local';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: any = null) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string | null, extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      cache: 'no-store',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
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
// editKeyGen：管理キーで開いたときだけ返る編集キーの世代（管理キーから編集リンクを作る）。導出する形より前の編集キーなら null
export type MemoInfo = { id: string; viewId: string | null; version: number; updatedAt: number; expiresAt: number; editKey: boolean; paid: boolean; editKeyGen?: number | null };
export type Created = MemoInfo & { role: Role };
export type EditData = MemoInfo & { song: Song; role: Role };
export type ViewData = {
  version: number; updatedAt: number; expiresAt: number; paid: boolean; song: Song;
  base: { version: number; song: Song } | null; notify: boolean; notes: { version: number; note: string }[];
};

// 一覧の曲メモの今の状態。gone：削除済み・期限切れ。曲名などは正しいキーがあるときだけ返る
export type MemoStatus = { id: string; gone?: true; title?: string; updatedAt?: number; expiresAt?: number; paid?: boolean; viewId?: string | null };

export type BpmCandidate = { source: 'GetSongBPM' | 'Deezer'; title: string; artist: string; bpm: number; url: string | null };
export type VideoCandidate = { id: string; title: string; channel: string; seconds: number };

export const api = {
  // 管理キーは端末で作り、サーバーにはハッシュだけを保存する（編集キーは管理キーから導出）。再送しても同じ曲メモになる
  create: (requestId: string, key: string, song: Song) => call<Created>('POST', '/api/memos', { requestId, key, song }),
  view: (viewId: string, since: number | null) => call<ViewData>('GET', `/api/view/${viewId}${since ? `?since=${since}` : ''}`),
  // 閲覧ページでキーを入れて編集を始める（閲覧識別子と、編集キーまたは管理キー）
  open: (viewId: string, key: string) => call<{ id: string; role: Role }>('POST', `/api/view/${viewId}/open`, {}, key),
  get: (id: string, key: string) => call<EditData>('GET', `/api/memos/${id}`, undefined, key),
  save: (id: string, key: string, baseVersion: number, song: Song, note: string, notify: boolean) =>
    call<MemoInfo>('PUT', `/api/memos/${id}`, { baseVersion, song, note, notify }, key),
  rekey: (id: string, key: string, next: string) => call<MemoInfo>('POST', `/api/memos/${id}/keys`, { key: next }, key),
  editKey: (id: string, key: string) => call<MemoInfo>('POST', `/api/memos/${id}/edit-key`, {}, key),
  stopEdit: (id: string, key: string) => call<MemoInfo>('DELETE', `/api/memos/${id}/edit-key`, undefined, key),
  reshare: (id: string, key: string) => call<MemoInfo>('POST', `/api/memos/${id}/share`, {}, key),
  unshare: (id: string, key: string) => call<MemoInfo>('DELETE', `/api/memos/${id}/share`, undefined, key),
  remove: (id: string, key: string) => call<null>('DELETE', `/api/memos/${id}`, undefined, key),
  // 無料・有料の切り替え（運営者だけ）。管理キーと、運営者のマイキーの照合用キー（X-Account）が要る
  plan: (id: string, key: string, auth: string, paid: boolean) => call<MemoInfo>('POST', `/api/memos/${id}/plan`, { paid }, key, { 'X-Account': auth }),
  operator: (auth: string) => call<{ operator: boolean }>('GET', '/api/operator', undefined, auth),
  status: (items: { id: string; key: string | null }[]) => call<{ items: MemoStatus[] }>('POST', '/api/memos/status', { items }),
  // マイキー：暗号化したキーの一覧（auth はマイキーから導出した照合用キー）
  account: (auth: string) => call<{ data: string; revision: number }>('GET', '/api/account', undefined, auth),
  putAccount: (auth: string, data: string, revision: number) => call<{ revision: number }>('PUT', '/api/account', { data, revision }, auth),
  deleteAccount: (auth: string) => call<{ deleted: true }>('DELETE', '/api/account', undefined, auth),
  // 曲名・アーティスト名でネット上の BPM 情報を調べる（音源は送らない）
  bpm: (title: string, artist: string) =>
    call<{ candidates: BpmCandidate[]; sources: string[] }>('GET', `/api/bpm?${new URLSearchParams({ title, artist })}`),
  // 曲名・アーティスト名で YouTube の動画を探す（音源は送らない）。available：サーバーで YouTube の検索が使えるか。limited：今日の上限に達して使えない
  youtube: (title: string, artist: string) =>
    call<{ videos: VideoCandidate[]; available: boolean; limited?: boolean }>('GET', `/api/youtube?${new URLSearchParams({ title, artist })}`),
};

// 利用イベント（内容を含まない）。失敗しても無視する
export function track(kind: string, extra: { durationMs?: number; error?: string; audioSec?: number } = {}) {
  const device = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  void call('POST', '/api/events', { kind, anon: anonId(), device, ...extra }).catch(() => {});
}
