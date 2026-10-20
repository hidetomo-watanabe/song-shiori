import { useState } from 'preact/hooks';
import { clampOffset, type Song } from '../../../shared/song';
import { fmt } from './util';

type Props = {
  song: Song;
  videoDuration: number; // 動画の長さ（ずれを足す前）
  videoTime: () => number; // 動画の上の再生位置（ずれを足す前）
  onChange: (offset: number) => void;
};

const describe = (x: number) => (x > 0 ? `動画のほうが ${x.toFixed(2)}秒 遅く始まる` : x < 0 ? `動画のほうが ${(-x).toFixed(2)}秒 早く始まる` : 'ずれなし');

// YouTube の動画と構成表のずれを合わせる。区間が始まった瞬間に押して合わせ、0.1秒ずつ動かして詰める。
// 音は読み取れないため自動では合わせられない
export function YouTubeAlign({ song, videoDuration, videoTime, onChange }: Props) {
  const offset = song.youtubeOffset ?? 0;
  const parts = song.sections.filter((s) => !s.silence);
  const [target, setTarget] = useState(parts[0]?.id ?? '');
  const sec = song.sections.find((s) => s.id === target) ?? parts[0] ?? song.sections[0];
  // 前後の余りを除いても長さが合わなければ、途中に演出が入るなど別バージョンの動画のことがある
  const lengthDiff = song.sections.length ? videoDuration - offset - song.duration : 0;
  return (
    <details class="more yt-align" open={offset !== 0 || Math.abs(lengthDiff) > 1.5}>
      <summary>音源とのずれを合わせる（{describe(offset)}）</summary>
      <p class="sub">曲頭の無音や MV の前置きの長さが音源と違うと、区間の位置が全体にずれます。合わせる区間を番号（下の構成の番号）で選び、動画を聴いてその区間が始まった瞬間に押してください。</p>
      {sec && (
        <div class="actions">
          <select value={sec.id} aria-label="合わせる区間" onChange={(e) => setTarget((e.currentTarget as HTMLSelectElement).value)}>
            {song.sections.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}（{fmt(s.start, 1)}〜）</option>)}
          </select>
          <button class="small primary" onClick={() => onChange(clampOffset(videoTime() - sec.start))}>今の位置をこの区間の頭にする</button>
        </div>
      )}
      <div class="actions">
        <span class="sub">細かく合わせる</span>
        <button class="small" onClick={() => onChange(clampOffset(offset - 0.1))}>−0.1秒</button>
        <input class="offset-input" type="number" step="0.01" value={offset} aria-label="ずれ（秒）"
          onChange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) onChange(clampOffset(v)); }} />
        <span>秒</span>
        <button class="small" onClick={() => onChange(clampOffset(offset + 0.1))}>＋0.1秒</button>
        {offset !== 0 && <button class="small ghost" onClick={() => onChange(0)}>0 に戻す</button>}
      </div>
      <p class="sub">合わせたら、区間の「ここから再生」で確かめてください。構成表の時刻は変わりません。</p>
      {Math.abs(lengthDiff) > 1.5 && (
        <p class="warn">
          動画は構成表より {Math.abs(lengthDiff).toFixed(1)}秒 {lengthDiff > 0 ? '長い' : '短い'}です（ずれを除いて比べています）。
          MV の終わりに別の場面があるだけなら問題ありません。途中に演出が入るなど別バージョンの動画だと、後ろの区間はずれが残ります。
        </p>
      )}
    </details>
  );
}
