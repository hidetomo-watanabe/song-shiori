import * as M from '../../../shared/song';
import type { Section, Song } from '../../../shared/song';
import { fmt, groupTone, nowClass } from './util';

type Props = {
  song: Song;
  s: Section;
  i: number;
  isCurrent: boolean; // 再生位置がこの区間の中か
  playing: boolean;
  hasAudio: boolean;
  rowRef: (el: HTMLLIElement | null) => void;
  onOpen: () => void;
  onPlay: () => void;
  onStop: () => void;
};

// 選んでいない区間は1行にたたみ、構成全体を見渡せるようにする。押すと開いて編集できる
export function FoldedSection({ song, s, i, isCurrent, playing, hasAudio, rowRef, onOpen, onPlay, onStop }: Props) {
  // コード進行（手入力・推定）とメモを1行で添える
  const c = M.sectionChords(song, s), memo = s.memo.trim();
  return (
    <li ref={rowRef} class={`section folded tone-${groupTone(s.group)}${s.cut ? ' cut' : ''}${nowClass(isCurrent, playing)}`} onClick={onOpen}>
      <div class="sec-summary">
        <span class="sec-no">{i + 1}</span>
        <span class="chip" aria-hidden="true" />
        <button class="sec-open" aria-expanded="false" aria-label={`区間${i + 1}「${s.name}」を開いて編集`}>{s.name || '（名前なし）'}</button>
        {s.barsNeedsCheck && <span class="tag warn">要確認</span>}
        {M.chordsDifferFromFirst(song, s) && <span class="tag warn">1回目と違う</span>}
        {s.cut && <span class="tag">カット</span>}
        {s.arrange?.trim() && <span class="tag warn" title={s.arrange}>原曲と違う</span>}
        <span class="sec-range">{fmt(s.start, 0)}〜{fmt(s.end, 0)}</span>
        <span class="sec-bars">{s.barsManual ?? s.barsEst ?? '-'}<span class="sub">小節{M.pickupBeats(song, s) != null && `＋${M.pickupBeats(song, s)}拍`}{M.sectionBpm(song, s) != null && `・${M.sectionBpm(song, s)} BPM`}</span></span>
        {hasAudio && (playing && isCurrent
          ? <button class="small row-play on" onClick={(e) => { e.stopPropagation(); onStop(); }}>停止</button>
          : <button class="small row-play" onClick={(e) => { e.stopPropagation(); onPlay(); }}>再生</button>)}
      </div>
      {c || memo ? (
        <div class="sec-peek">
          {c && <span class={`chords${c.source === 'estimate' ? ' est' : ''}`} title={c.source === 'estimate' ? '推定（閲覧ページには出ません）' : undefined}>{c.text}</span>}
          {memo && <span>{memo}</span>}
        </div>
      ) : null}
    </li>
  );
}
