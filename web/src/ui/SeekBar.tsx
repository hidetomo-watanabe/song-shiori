import { useState } from 'preact/hooks';
import { fmt } from './util';

type Props = {
  now: number;
  onSeek: (t: number) => void;
  duration?: number; // 曲全体のシークバー（0〜duration）
  range?: { start: number; end: number }; // 区間のシークバー（start〜end）
  compact?: boolean;
  label?: string;
};

// 再生位置のシークバー。つまみを動かしている間は位置だけを表示し、離したときに移動する
export function SeekBar({ now, onSeek, duration = 0, range, compact, label = '再生位置' }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const min = range?.start ?? 0;
  const max = range?.end ?? duration;
  const inside = now >= min && now < max;
  // 区間のシークバーは、再生位置が区間の外なら区間の頭につまみを置く
  const value = dragging ?? (range && !inside ? min : now);
  const commit = (v: number) => { setDragging(null); onSeek(v); };
  return (
    <div class={`seekbar${compact ? ' compact' : ''}${range ? ' section-seek' : ''}${range && !inside && dragging == null ? ' idle' : ''}`}>
      {!compact && <span class="time">{fmt(value)}</span>}
      <input type="range" min={min} max={max} step={0.1} value={value} aria-label={label} aria-valuetext={fmt(value)}
        onInput={(e) => setDragging(Number((e.currentTarget as HTMLInputElement).value))}
        onChange={(e) => commit(Number((e.currentTarget as HTMLInputElement).value))} />
      {!compact && <span class="time">{fmt(max)}</span>}
    </div>
  );
}
