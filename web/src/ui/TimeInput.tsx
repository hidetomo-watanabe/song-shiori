import { useEffect, useState } from 'preact/hooks';
import { fmt, parseTime } from './util';

// 時刻（分:秒）の入力。入力中は外からの値で書き換えず、確定（フォーカスを外す・Enter）したときに反映する
export function TimeInput({ value, onChange }: { value: number | null; onChange: (t: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : fmt(value, 2));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value == null ? '' : fmt(value, 2)); }, [value, focus]);
  const commit = () => {
    setFocus(false);
    if (text.trim() === '') { onChange(null); return; }
    const t = parseTime(text);
    if (t == null) setText(value == null ? '' : fmt(value, 2));
    else onChange(t);
  };
  return (
    <input class="time-input" value={text} placeholder="未設定" inputMode="decimal" aria-label="時刻（分:秒）"
      onFocus={() => setFocus(true)}
      onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
  );
}
