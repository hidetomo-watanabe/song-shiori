import type { CountMode } from '../../../shared/song';
import { setCountIn } from '../storage/local';

type Props = { value: CountMode; onChange: (v: CountMode) => void };

// 再生の前のカウントの選択（編集画面・閲覧ページで共通。この端末に覚えておく）
export function CountInSelect({ value, onChange }: Props) {
  return (
    <label class="count-in" title={'再生を始める前に、メトロノームの音でカウントを鳴らします（ループで頭に戻るたびには鳴らしません）。\n「最初の区間だけ」は、最初の区間から再生するときだけ1小節カウントします'}>
      <span class="sub">カウント</span>
      <select value={String(value)} onChange={(e) => {
        const t = (e.currentTarget as HTMLSelectElement).value;
        const v: CountMode = t === 'first' ? 'first' : t === '1' ? 1 : t === '2' ? 2 : 0;
        onChange(v);
        setCountIn(v);
      }}>
        <option value="0">なし</option><option value="1">1小節</option><option value="2">2小節</option>
        <option value="first">最初の区間だけ（1小節）</option>
      </select>
    </label>
  );
}

// YouTube の動画で再生するときの注意。鳴らす設定でなければ null
export const countInNote = (value: CountMode): string | null =>
  value ? '動画では、カウントの後に少し遅れて始まることがあります。' : null;
