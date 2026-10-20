import { useRef, useState } from 'preact/hooks';
import type { Song } from '../../../shared/song';

export type EditOptions = { history?: boolean; coalesce?: string };

// 構成データと「元に戻す」「やり直す」の履歴
export function useSongHistory() {
  const [song, setSong] = useState<Song | null>(null);
  const ref = useRef<Song | null>(null);
  const history = useRef<Song[]>([]);
  const future = useRef<Song[]>([]); // 元に戻した変更。新しく編集すると消える
  const coalesce = useRef<{ key: string; at: number } | null>(null);
  const [dirty, setDirty] = useState(false);

  const show = (s: Song) => {
    ref.current = s;
    setSong(s);
  };

  // 読み込んだ曲で始める（履歴は空にする）
  function init(s: Song) {
    history.current = [];
    future.current = [];
    show(s);
  }

  // 変更する。同じ coalesce の変更が続いたときは1つの履歴にまとめる。変わったら true
  function edit(fn: (s: Song) => Song, opts: EditOptions = {}): boolean {
    const cur = ref.current;
    if (!cur) return false;
    const next = fn(cur);
    if (next === cur) return false;
    const c = coalesce.current;
    const merge = opts.history === false || (opts.coalesce && c?.key === opts.coalesce && Date.now() - c.at < 1500);
    if (!merge) history.current = [...history.current.slice(-99), cur];
    future.current = [];
    coalesce.current = opts.coalesce ? { key: opts.coalesce, at: Date.now() } : null;
    show(next);
    setDirty(true);
    return true;
  }

  // 今の状態を履歴に積む（境界のドラッグのように、続けて history: false で変更する前に呼ぶ）
  function checkpoint() {
    history.current = [...history.current.slice(-99), ref.current!];
    future.current = [];
    coalesce.current = null;
  }

  function step(from: Song[], to: Song[]) {
    const s = from.pop();
    if (!s) return;
    to.push(ref.current!);
    coalesce.current = null;
    show(s);
    setDirty(true);
  }
  const undo = () => step(history.current, future.current);
  const redo = () => step(future.current, history.current);

  return {
    song, ref, dirty, setDirty, init, edit, checkpoint, undo, redo,
    canUndo: history.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
