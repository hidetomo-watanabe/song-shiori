import { useRef } from 'preact/hooks';
import type { Song } from '../../../shared/song';
import { fmt, groupTone } from './util';

type Props = {
  song: Song;
  now: number;
  showPlayhead: boolean;
  selected: string | null;
  onSeek: (t: number) => void;
  onSelect: (id: string) => void;
  onDragStart: () => void;
  onDrag: (index: number, t: number) => void;
};

// 区間の帯と境界のつまみ。つまみをドラッグすると境界が動く
export function Timeline({ song, now, showPlayhead, selected, onSeek, onSelect, onDragStart, onDrag }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const dur = song.duration || 1;
  const pct = (t: number) => `${(t / dur) * 100}%`;
  const toTime = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur;
  };

  if (!song.sections.length) return null;
  return (
    <div class={`timeline${showPlayhead ? ' tracking' : ''}`} ref={ref} aria-label="構成のタイムライン">
      {song.sections.map((s) => (
        <div
          key={s.id}
          class={`seg tone-${groupTone(s.group)}${showPlayhead && now >= s.start && now < s.end ? ' now' : ''}`}
          style={{ left: pct(s.start), width: pct(s.end - s.start) }}
          title={`${s.name}（${fmt(s.start)}〜${fmt(s.end)}）`}
          onPointerDown={(e) => { onSelect(s.id); onSeek(toTime(e.clientX)); }}
        >
          {s.group && <span class="seg-group">{s.group}</span>}
          <span>{s.name}</span>
        </div>
      ))}
      {song.sections.slice(1).map((s, k) => (
        <div
          key={`h-${s.id}`}
          class="handle"
          style={{ left: pct(s.start) }}
          role="slider"
          aria-label={`${s.name}の開始位置`}
          aria-valuetext={fmt(s.start)}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            dragging.current = k + 1;
            onDragStart();
          }}
          onPointerMove={(e) => { if (dragging.current != null) onDrag(dragging.current, toTime(e.clientX)); }}
          onPointerUp={() => { dragging.current = null; }}
          onPointerCancel={() => { dragging.current = null; }}
        />
      ))}
      {showPlayhead && <div class="playhead" style={{ left: pct(now) }} />}
    </div>
  );
}
