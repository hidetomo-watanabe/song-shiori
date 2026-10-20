import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { copy } from './util';

// 値（URL・キー）を表示し、コピーできるようにする。children はコピーの横に並べるボタンなど
export function CopyRow({ value, children }: { value: string; children?: ComponentChildren }) {
  const [copied, setCopied] = useState(false);
  return (
    <div class="copy-row">
      <code>{value}</code>
      <button onClick={async () => setCopied(await copy(value))}>{copied ? 'コピー済み' : 'コピー'}</button>
      {children}
    </div>
  );
}
