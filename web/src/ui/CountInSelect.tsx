import { introSection, type CountMode, type Song } from '../../../shared/song';
import { setCountIn } from '../storage/local';

type Props = { song: Song; value: CountMode; onChange: (v: CountMode) => void };

// 再生の前のカウントの選択（編集画面・閲覧ページで共通。この端末に覚えておく）。
// 「イントロ前だけ」は、イントロ前の区間がある曲だけ選べる
export function CountInSelect({ song, value, onChange }: Props) {
  const intro = !!introSection(song);
  return (
    <label class="count-in" title={'再生を始める前に、メトロノームの音でカウントを鳴らします（ループで頭に戻るたびには鳴らしません）。\n「イントロ前だけ」は、イントロ前の区間から再生するときだけ1小節カウントします'}>
      <span class="sub">カウント</span>
      <select value={String(value)} onChange={(e) => {
        const t = (e.currentTarget as HTMLSelectElement).value;
        const v: CountMode = t === 'intro' ? 'intro' : t === '1' ? 1 : t === '2' ? 2 : 0;
        onChange(v);
        setCountIn(v);
      }}>
        <option value="0">なし</option><option value="1">1小節</option><option value="2">2小節</option>
        {(intro || value === 'intro') && <option value="intro">イントロ前だけ（1小節）</option>}
      </select>
    </label>
  );
}

// YouTube の動画で再生するときの注意。鳴らす設定でなければ null
export function countInNote(song: Song, value: CountMode): string | null {
  if (!value) return null;
  if (value === 'intro' && !introSection(song)) return null;
  return '動画では、カウントの後に少し遅れて始まることがあります。';
}
