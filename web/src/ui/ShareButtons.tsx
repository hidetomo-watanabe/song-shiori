import { canShare, copyWithToast, lineShare, otherShare } from './util';

type Props = {
  text: () => string; // 送る文（押したときに作る）
  lineLabel?: string;
  copyLabel?: string | null; // null ならコピーのボタンを出さない（すぐ近くに別のコピーがあるとき）
  compact?: boolean;
};

// 共有のボタン（ライブのしおりと同じ形）：LINE で送る（主）・コピー・ほかのアプリで送る（端末の共有メニューがあるときだけ）
export function ShareButtons({ text, lineLabel = 'LINEで送る', copyLabel = 'リンクをコピー', compact }: Props) {
  return (
    <div class={`share-buttons${compact ? ' compact' : ''}`}>
      <div class="share-main">
        <button class={`line${compact ? ' small' : ''}`} onClick={() => void lineShare(text())}>{lineLabel}</button>
        {copyLabel && <button class={compact ? 'small' : ''} onClick={() => void copyWithToast(text(), '送る内容をコピーしました。')}>{copyLabel}</button>}
      </div>
      {canShare && <button class="link sub" onClick={() => void otherShare(text())}>ほかのアプリで送る</button>}
    </div>
  );
}
