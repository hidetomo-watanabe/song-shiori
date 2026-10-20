import { canShare, copyWithToast, lineShare, otherShare } from './util';

type Props = {
  text: () => string; // 送る文（押したときに作る）
  title: string; // 共有メニューに渡す件名（曲名）
  copyLabel?: string;
  copied?: string; // コピーしたときの通知
};

// 共有のボタン（ライブのしおりの共有パネルと同じ形）：「曲名とリンクをコピー」「LINEで送る」を2つ並べ、
// 端末の共有メニューがあるときだけ「ほかのアプリで送る」を出す。PC では「LINEで送る」を隠す（style.css の .pc）
export function ShareButtons({ text, title, copyLabel = '曲名とリンクをコピー', copied = '曲名とリンクをコピーしました。' }: Props) {
  return (
    <div class="share-buttons">
      <div class="two">
        <button onClick={() => void copyWithToast(text(), copied)}>{copyLabel}</button>
        <button class="line" onClick={() => void lineShare(text())}>LINEで送る</button>
      </div>
      {canShare && <button class="link sub" onClick={() => void otherShare(text(), title)}>ほかのアプリで送る</button>}
    </div>
  );
}
