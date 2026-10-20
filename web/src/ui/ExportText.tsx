import { useState } from 'preact/hooks';
import type { Song } from '../../../shared/song';
import { songToText } from '../../../shared/truth';
import { copy } from './util';

// 構成表をテキストで書き出す（コピー・保存）。LINE に貼る、印刷する、ほかのメモに残すときに使う
export function ExportText({ song }: { song: Song }) {
  const [copied, setCopied] = useState(false);
  if (!song.sections.length) return null;
  const save = () => {
    const blob = new Blob([songToText(song)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(song.title || '構成表').replace(/[\\/:*?"<>|]/g, '')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div class="export">
      <span class="sub">構成表を書き出す</span>
      <button class="small" onClick={async () => { setCopied(await copy(songToText(song))); setTimeout(() => setCopied(false), 2000); }}>
        {copied ? 'コピーしました' : 'テキストをコピー'}
      </button>
      <button class="small" onClick={save}>テキストで保存</button>
    </div>
  );
}
