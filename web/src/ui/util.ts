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
// どの曲の構成表か分かるよう、文のほうに曲名を入れる。1行目を曲名にして、LINE の通知やトークの一覧でも分かるようにする
const songLine = (title: string, artist: string) => `${title || '曲名未入力'}${artist ? ` / ${artist}` : ''}`;
export const shareMessage = (title: string, artist: string, url: string) => `${songLine(title, artist)}\n構成表（曲のしおり）\n${url}`;
// メンバーに送る文：閲覧 URL と編集キー（管理キーは入れない）
export const memberMessage = (title: string, artist: string, url: string, editKey: string) =>
  `${songLine(title, artist)}\n構成表（曲のしおり）\n${url}\n\n直すときは、ページの下の「編集する」で次の編集キーを入れてください。\n編集キー：${editKey}`;

// コピー・共有の結果は、押したボタンから離れた場所だと気づきにくいため、画面下の通知（トースト）で出す（ライブのしおりと同じ）
export function toast(message: string) {
  let t = document.getElementById('toast') as (HTMLDivElement & { timer?: number }) | null;
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(t.timer);
  t.timer = window.setTimeout(() => t!.classList.remove('show'), 4000);
}

// LINE で送る：スマホでは LINE 公式の共有 URL（アプリが開き、送る相手を選べる）。PC では共有 URL が LINE アプリを開けず
// LINE のトップページに飛ぶため、送る内容をコピーして貼り付けてもらう（iPad は Mac として名乗るのでタッチ対応で判定）
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
export async function lineShare(text: string) {
  if (isMobile) { window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); return; }
  toast((await copy(text)) ? '送る内容をコピーしました。PC の LINE でトークを開き、貼り付けて送ってください。' : 'コピーできませんでした。「リンクをコピー」から送ってください。');
}
// ほかのアプリで送る：端末の共有メニュー。使える端末でだけ出す
export const canShare = typeof navigator !== 'undefined' && !!navigator.share;
export async function otherShare(text: string) {
  try { await navigator.share({ text }); } catch (e) { if ((e as Error).name !== 'AbortError') toast('共有できませんでした。「リンクをコピー」から送ってください。'); }
}
export async function copyWithToast(text: string, done: string) {
  toast((await copy(text)) ? done : 'コピーできませんでした。長押しして選び、コピーしてください。');
}

// 画面間の受け渡し（選択したファイル、作成直後の秘密キー）
export const handoff: { file: File | null; created: { id: string; viewId: string; key: string; editKey: string; title: string; artist: string } | null } = { file: null, created: null };
