import { useState } from 'preact/hooks';
import { songFromText, type Imported } from '../../../shared/importText';
import type { Song } from '../../../shared/song';

type Props = { song: Song; duration?: number; onImport: (song: Song) => void; onClose: () => void };

// テキスト（構成表の書き出し）を貼り付けるか .txt を選んで、構成を置き換える
export function ImportText({ song, duration, onImport, onClose }: Props) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Imported | null>(null);
  const read = (t: string) => { setText(t); setResult(t.trim() ? songFromText(t, song, duration) : null); };
  const parts = result?.song.sections.filter((s) => !s.silence) ?? [];
  const ok = !!result && parts.length > 0 && result.song !== song;
  return (
    <div class="import">
      <p class="sub">「テキストをコピー」「テキストで保存」で書き出した構成表を、貼り付けるかファイルで選んでください。</p>
      <textarea rows={6} value={text} placeholder={'0:00.0 （無音）\n0:01.5 イントロ 8小節\n0:17.0 Aメロ 16小節'} onInput={(e) => read((e.currentTarget as HTMLTextAreaElement).value)} />
      <div class="import-row">
        <label class="button file small">
          ファイルを選ぶ
          <input type="file" accept=".txt,text/plain" onChange={async (e) => {
            const input = e.currentTarget as HTMLInputElement;
            const f = input.files?.[0];
            input.value = '';
            if (f) read(await f.text());
          }} />
        </label>
        <button class="small" onClick={onClose}>やめる</button>
      </div>
      {result && (
        <div class="import-preview">
          {ok && <p>{result.song.title || '曲名なし'}・{result.song.bpmManual ?? result.song.bpmEst ?? 'BPM 未確定'}・{parts.length}区間（{parts.map((s) => s.name).slice(0, 6).join('、')}{parts.length > 6 ? '…' : ''}）</p>}
          {result.warnings.map((w) => <p key={w} class="warn">{w}</p>)}
          {ok && (
            <>
              <p class="sub">いまの区間・名前・小節数・メモは置き換わります（「元に戻す」で取り消せます）。</p>
              <button class="small primary" onClick={() => onImport(result.song)}>この構成で置き換える</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
