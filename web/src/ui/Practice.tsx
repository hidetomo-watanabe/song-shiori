import { useEffect, useRef, useState } from 'preact/hooks';
import type { Song } from '../../../shared/song';
import { confirmedChords } from '../../../shared/song';
import { groupTone, timeSignature } from './util';

type Props = {
  song: Song;
  bpm: number | null;
  keyText: string | null; // 演奏するキーの表示
  showChords: (text: string) => string; // コード進行を演奏するキーに直す
  onClose: () => void;
};

// 練習中に譜面台やスマートフォンで見るための表示。大きな文字で、区間名・小節数・原曲との違い・コード・メモだけを並べる。
// カットした区間は出さない。表示している間は画面が消えないようにし、区間を押すと「今ここ」の印を付ける
export function Practice({ song, bpm, keyText, showChords, onClose }: Props) {
  const [at, setAt] = useState<string | null>(null);
  const [big, setBig] = useState(() => { try { return localStorage.getItem('ks-practice-big') === '1'; } catch { return false; } });
  const rows = useRef(new Map<string, HTMLLIElement>());
  const played = song.sections.filter((s) => !s.cut);
  const cut = song.sections.length - played.length;

  // 画面が消えないようにする（対応していないブラウザでは何もしない）。別のタブから戻ったときは取り直す
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    const take = () => { if (wl && document.visibilityState === 'visible') wl.request('screen').then((l) => { lock = l; }, () => {}); };
    take();
    document.addEventListener('visibilitychange', take);
    return () => { document.removeEventListener('visibilitychange', take); void lock?.release().catch(() => {}); };
  }, []);

  // Esc で閉じる、↑↓で「今ここ」を動かす
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const i = played.findIndex((s) => s.id === at);
      const next = played[Math.max(0, Math.min(played.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) setAt(next.id);
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });
  useEffect(() => { if (at) rows.current.get(at)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [at]);

  // 開いている間は後ろのページをスクロールさせない
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const toggleBig = () => {
    setBig(!big);
    try { localStorage.setItem('ks-practice-big', big ? '0' : '1'); } catch { /* 覚えられなくても表示はできる */ }
  };

  return (
    <div class={`practice${big ? ' big' : ''}`} role="dialog" aria-modal="true" aria-label={`${song.title || '曲'}の練習用の表示`}>
      <header class="practice-head">
        <h2>{song.title || '曲名未入力'}</h2>
        <button class="small" onClick={toggleBig}>{big ? '文字を戻す' : '文字を大きく'}</button>
        <button class="small" onClick={onClose}>閉じる</button>
      </header>
      <p class="practice-meta">
        {bpm ? `BPM ${bpm}` : 'BPM 未確定'}<span>{timeSignature(song.beatsPerBar)}</span>{keyText && <span>{keyText}</span>}
      </p>
      <ol class="practice-list">
        {played.map((s) => {
          const c = confirmedChords(song, s);
          return (
            <li key={s.id} ref={(el) => { if (el) rows.current.set(s.id, el); else rows.current.delete(s.id); }}
              class={`tone-${groupTone(s.group)}${at === s.id ? ' at' : ''}`} onClick={() => setAt(at === s.id ? null : s.id)}>
              <div class="p-main"><span class="p-name">{s.name}</span><span class="p-bars">{s.barsManual ?? s.barsEst ?? '-'}<small>小節</small></span></div>
              {s.arrange?.trim() && <div class="p-arrange">※ {s.arrange}</div>}
              {c && <div class="p-chords">{showChords(c.text)}</div>}
              {s.memo.trim() && <div class="p-memo">{s.memo}</div>}
            </li>
          );
        })}
      </ol>
      <p class="practice-foot">
        {cut > 0 && `カットした区間（${cut}）は表示していません。`}区間を押すと「今ここ」の印が付きます（PC は ↑↓ キー）。
      </p>
    </div>
  );
}
