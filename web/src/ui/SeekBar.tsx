import { useState } from 'preact/hooks';
import { fmt } from './util';

type Props = { now: number; duration: number; onSeek: (t: number) => void; compact?: boolean };

// 再生位置のシークバー。つまみを動かしている間は位置だけを表示し、離したときに移動する
export function SeekBar({ now, duration, onSeek, compact }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const value = dragging ?? now;
  const commit = (v: number) => { setDragging(null); onSeek(v); };
  return (
    <div class={`seekbar${compact ? ' compact' : ''}`}>
      {!compact && <span class="time">{fmt(value)}</span>}
      <input type="range" min={0} max={duration || 0} step={0.1} value={value} aria-label="再生位置" aria-valuetext={fmt(value)}
        onInput={(e) => setDragging(Number((e.currentTarget as HTMLInputElement).value))}
        onChange={(e) => commit(Number((e.currentTarget as HTMLInputElement).value))} />
      {!compact && <span class="time">{fmt(duration)}</span>}
    </div>
  );
}
