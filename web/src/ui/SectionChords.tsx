import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import * as M from '../../../shared/song';
import type { Section, Song } from '../../../shared/song';

// 区間のコード進行。推定（または繰り返しの1回目）を表示し、書き換えるとこの区間の手入力になる
export function SectionChords({ song, s, onChange }: { song: Song; s: Section; onChange: (v: string | null, coalesce?: boolean) => void }) {
  const c = M.sectionChords(song, s);
  // 長いコード進行や狭い画面では折り返すので、中身に合わせて高さを変える
  const box = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  useLayoutEffect(fit);
  // 開いた直後や画面の幅が変わったときは、行の配置が決まってから幅が変わるので、幅が変わるたびに合わせ直す
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // 監視を始めた直後の1回目でも合わせる（開いた直後の幅の変化は、監視を始める前に起きていることがある）
    let width = -1;
    const ro = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const differs = M.chordsDifferFromFirst(song, s);
  return (
    <div class="sec-chords">
      <span class="sub">コード</span>
      {/* 改行は入れない（1行のコード進行として扱う） */}
      <textarea ref={box} class="chords" value={c?.text ?? ''} maxLength={M.LIMITS.chordText} aria-label="コード進行" rows={1}
        placeholder={song.chords ? '（推定なし）例：| Am | G | F | E7 |' : '例：| Am | G | F | E7 |'}
        onInput={(e) => onChange((e.currentTarget as HTMLTextAreaElement).value.replace(/\s*\n\s*/g, ' '), true)} />
      {/* 印とボタンは欄の下の行に置く（欄の横に置くと、欄の高さで折り返しが変わり、幅と高さが交互に変わり続けるため） */}
      {(c && c.source !== 'manual') || differs || s.chords != null ? (
        <div class="chords-meta">
          {c && c.source !== 'manual' && <span class="tag">{c.source === 'repeat' ? '1回目と同じ' : '推定（閲覧ページには出ません）'}</span>}
          {c?.source === 'estimate' && <button class="tiny" title="聴いて確かめた推定を、この区間のコード進行として使います（閲覧ページに出ます）" onClick={() => onChange(c.text)}>このまま使う</button>}
          {differs && <span class="tag warn">1回目と違う</span>}
          {s.chords != null && <button class="tiny" onClick={() => onChange(null)}>手入力をやめる</button>}
        </div>
      ) : null}
    </div>
  );
}
