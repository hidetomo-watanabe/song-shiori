import { copyWithToast, lineShare } from './util';

type Props = {
  text: () => string; // 送る文（押したときに作る）
  copyLabel?: string;
  copied?: string; // コピーしたときの通知
};

// 共有のボタン（ライブのしおりの共有パネルと同じ形）：スマホでは「曲名とリンクをコピー」「LINEで送る」を2つ並べ、
// PC では「LINEで送る」を隠してコピーだけにする（style.css の .pc）
export function ShareButtons({ text, copyLabel = '曲名とリンクをコピー', copied = '曲名とリンクをコピーしました。' }: Props) {
  return (
    <div class="share-buttons">
      <div class="two">
        <button onClick={() => void copyWithToast(text(), copied)}>{copyLabel}</button>
        <button class="line" onClick={() => void lineShare(text())}>LINEで送る</button>
      </div>
    </div>
  );
}
