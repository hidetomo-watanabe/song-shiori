import { useState } from 'preact/hooks';
import { songFromText, type Imported } from '../../../shared/importText';
import type { Song } from '../../../shared/song';

type Props = { song: Song; duration?: number; onImport: (song: Song) => void; onClose: () => void };

// テキスト（構成表の書き出し）を貼り付けるか、.txt を選ぶ・落として、構成を置き換える
export function ImportText({ song, duration, onImport, onClose }: Props) {
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<Imported | null>(null);
  const read = (t: string) => { setText(t); setResult(t.trim() ? songFromText(t, song, duration) : null); };
  const parts = result?.song.sections ?? [];
  const ok = !!result && parts.length > 0 && result.song !== song;
  const hasFile = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  // ファイルを落としたときは中身を読む。ブラウザがファイルをタブで開いて編集画面から離れないよう、標準の動きは止める
  const onDrop = async (e: DragEvent) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer!.files[0];
    if (f) read(await f.text());
  };
  return (
    <div class={`import${over ? ' drop-over' : ''}`}
      onDragOver={(e) => { if (hasFile(e)) { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; setOver(true); } }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={onDrop}>
      <p class="sub">「テキストをコピー」「テキストで保存」で書き出した構成表を、貼り付けるか、ファイルを選ぶかここに落としてください。</p>
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
        <button class="small" onClick={onClose}>キャンセル</button>
      </div>
      {result && (
        <div class="import-preview">
          {ok && <p>{result.song.title || '曲名なし'}・{result.song.bpmManual ?? result.song.bpmEst ?? 'BPM 未確定'}・{parts.length}区間（{parts.map((s) => s.name).slice(0, 6).join('、')}{parts.length > 6 ? '…' : ''}）{result.song.youtube && result.song.youtube !== song.youtube ? '・YouTube の動画' : ''}</p>}
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
