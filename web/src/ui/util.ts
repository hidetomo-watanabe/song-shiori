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

// 拍子の表記。1小節の拍の数から「4/4」「6/8」のように表す（6・7拍は8分音符を1拍として数える）
export const TIME_SIGNATURES = [4, 3, 2, 5, 6, 7];
export const timeSignature = (beats: number) => (beats === 6 || beats === 7 ? `${beats}/8` : `${beats}/4`);

export const go = (hash: string, replace = false) => {
  if (replace) location.replace(hash);
  else location.hash = hash;
};

export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export const viewUrl = (viewId: string) => `${location.origin}${location.pathname}#/v/${viewId}`;

// 共有の文。LINE などのリンクの表示は曲によらず同じ（閲覧ページの URL は # 以降がサーバーに届かないため）なので、
// どの曲の構成表か分かるよう、文のほうに曲名を入れる
export const shareTitle = (title: string, artist = '') => `曲のしおり「${title || '曲名未入力'}」${artist ? `（${artist}）` : ''}の構成表`;
export const shareMessage = (title: string, artist: string, url: string) => `${shareTitle(title, artist)}\n${url}`;
// メンバーに送る文：閲覧 URL と編集キー（管理キーは入れない）
export const memberMessage = (title: string, artist: string, url: string, editKey: string) =>
  `${shareTitle(title, artist)}です。\n${url}\n\n直すときは、ページの下の「編集する」で次の編集キーを入れてください。\n編集キー：${editKey}`;

// 画面間の受け渡し（選択したファイル、作成直後の秘密キー）
export const handoff: { file: File | null; created: { id: string; viewId: string; key: string; editKey: string; title: string; artist: string } | null } = { file: null, created: null };
