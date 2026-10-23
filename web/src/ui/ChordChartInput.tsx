import { useState } from 'preact/hooks';
import * as M from '../../../shared/song';
import type { Song } from '../../../shared/song';

// コード譜は U-FRET などで探して、正しい曲のページの URL を貼ってもらい、閲覧ページにリンクとして出す。
// 内容は取り込まない（U-FRET の規約で閲覧以外の利用はできないため）
export function ChordChartInput({ song, onChange }: { song: Song; onChange: (url: string | null) => void }) {
  const [text, setText] = useState<string | null>(null); // 入力中の文字（正しい URL になるまで構成データに入れない）
  const invalid = text != null && !!text.trim() && !M.chordChartUrl(text);
  return (
    <div class="chart-row">
      <label class="inline">コード譜
        <input type="url" inputMode="url" value={text ?? song.chordChartUrl ?? ''} maxLength={M.LIMITS.url}
          placeholder="U-FRET などのコード譜のページの URL" aria-invalid={invalid || undefined}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            setText(v);
            const u = M.chordChartUrl(v);
            if (u || !v.trim()) onChange(u);
          }}
          onBlur={() => { if (!invalid) setText(null); }} />
      </label>
      {song.title.trim() && (
        <a class="button small" target="_blank" rel="noopener" title="U-FRET で曲名・アーティスト名を検索します（新しいタブ）。見つけたページの URL を左の欄に貼ってください"
          href={`https://www.ufret.jp/search.php?${new URLSearchParams({ key: `${song.title} ${song.artist}`.trim() })}`}>U-FRET で探す</a>
      )}
      {song.chordChartUrl && <a class="button small" target="_blank" rel="noopener noreferrer" href={song.chordChartUrl}>開く</a>}
      {invalid ? <span class="error">https:// で始まる URL を貼ってください</span>
        : <span class="sub">閲覧ページにリンクとして出ます。見つからないときは U-FRET で曲名の表記（の／ノなど）を変えて探してください。</span>}
    </div>
  );
}
