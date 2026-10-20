// 画面共通の小さな関数
export function fmt(t: number | null | undefined, digits = 1): string {
  if (t == null || !Number.isFinite(t)) return '-';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(digits).padStart(digits ? 3 + digits : 2, '0')}`;
}

// 「1:23.4」または「83.4」を秒に直す。読めなければ null
export function parseTime(text: string): number | null {
  const m = text.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
}

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('ja-JP');

// 繰り返しの色番号（色だけに頼らず、画面では「繰り返しA」なども併記する）
export const groupTone = (g: string | null) => (g ? (g.charCodeAt(0) - 65 + (g.length - 1) * 3) % 10 : -1);

export const go = (hash: string, replace = false) => {
  if (replace) location.replace(hash);
  else location.hash = hash;
};

export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const viewUrl = (viewId: string) => `${location.origin}${location.pathname}#/v/${viewId}`;

// 画面間の受け渡し（選択したファイル、作成直後の秘密キー）
export const handoff: { file: File | null; created: { id: string; viewId: string; key: string } | null } = { file: null, created: null };
