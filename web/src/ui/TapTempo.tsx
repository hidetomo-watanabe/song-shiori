import { useEffect, useRef, useState } from 'preact/hooks';
import { MIN_TAPS, tapTempo } from '../../../shared/song';

type Props = {
  // 再生中なら曲の頭からの位置（秒）。止まっていれば null（BPM だけを求め、最初の小節頭は決めない）
  position: () => number | null;
  onDone: (bpm: number, first: number | null) => void;
};

const IDLE = 2000; // これだけ押さなければ確定する（ミリ秒）

// 拍に合わせてボタン（または T キー）を押して BPM を求める。再生しながら押すと、最初に押した位置を小節の頭にする
export function TapTempo({ position, onDone }: Props) {
  const taps = useRef<number[]>([]);
  const synced = useRef(false); // 曲の位置で記録しているか
  const timer = useRef(0);
  const [count, setCount] = useState(0);
  const [bpm, setBpm] = useState<number | null>(null);
  // T キーの処理は最初の描画で登録するため、最新の props を参照で渡す
  const props = useRef({ position, onDone });
  props.current = { position, onDone };

  function finish() {
    const r = tapTempo(taps.current);
    if (r) props.current.onDone(r.bpm, synced.current ? r.first : null);
    taps.current = [];
    setCount(0);
    setBpm(null);
  }

  function tap() {
    const pos = props.current.position();
    const t = pos ?? performance.now() / 1000;
    const last = taps.current[taps.current.length - 1];
    // 再生を始めた・止めた、シークした、間が空いたときは押し直しとして数え直す
    if (!taps.current.length || synced.current !== (pos != null) || !(t > last) || t - last > IDLE / 1000) {
      taps.current = [];
      synced.current = pos != null;
    }
    taps.current.push(t);
    setCount(taps.current.length);
    setBpm(tapTempo(taps.current)?.bpm ?? null);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(finish, IDLE);
  }

  // PC では T キーでも押せる（入力欄の中では使わない）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 't') { e.preventDefault(); tap(); }
    };
    addEventListener('keydown', on);
    return () => { removeEventListener('keydown', on); clearTimeout(timer.current); };
  }, []);

  return (
    <>
      <button type="button" class={`small${count ? ' on' : ''}`} onClick={tap}
        title="拍に合わせて4回以上押すと BPM を求めます（T キーでも押せます）。再生しながら、小節の1拍目から押し始めると小節の頭も合わせます">
        {count ? `タップ ${count}回${bpm ? `・${bpm}` : ''}` : '👆 タップ'}
      </button>
      {count > 0 && count < MIN_TAPS && <span class="sub">あと{MIN_TAPS - count}回</span>}
    </>
  );
}
