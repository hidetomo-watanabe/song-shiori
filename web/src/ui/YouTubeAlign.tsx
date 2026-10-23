import { useState } from 'preact/hooks';
import { clampOffset, type Song } from '../../../shared/song';
import { locateClip, mono } from '../audio/align';
import { canCaptureTab, captureTab } from '../audio/tabCapture';
import type { YouTubePlayer } from '../audio/youtube';
import { fmt } from './util';

type Props = {
  song: Song;
  videoDuration: number; // 動画の長さ（ずれを足す前）
  videoTime: () => number; // 動画の上の再生位置（ずれを足す前）
  onChange: (offset: number) => void;
  video?: YouTubePlayer | null; // 自動で合わせるときに動画を流す
  audio?: { buffer: AudioBuffer; offset: number } | null; // 自動で合わせるときに比べる音源ファイル（offset：曲の頭が何秒目か）
};

const CAPTURE_SECONDS = 20;

const describe = (x: number) => (x > 0 ? `動画のほうが ${x.toFixed(2)}秒 遅く始まる` : x < 0 ? `動画のほうが ${(-x).toFixed(2)}秒 早く始まる` : 'ずれなし');

// YouTube の動画と構成表のずれを合わせる。区間が始まった瞬間に押して合わせ、0.1秒ずつ動かして詰める。
// 音は読み取れないため自動では合わせられない
export function YouTubeAlign({ song, videoDuration, videoTime, onChange, video, audio }: Props) {
  const offset = song.youtubeOffset ?? 0;
  const [target, setTarget] = useState(song.sections[0]?.id ?? '');
  const [auto, setAuto] = useState<{ busy: boolean; sec?: number; ok?: string; error?: string }>({ busy: false });

  // タブの音を取り込み、音源ファイルのどこにあたるかを探して、ずれを決める
  async function autoAlign() {
    if (!video || !audio) return;
    // 音のはっきりした所で比べるため、いちばん大きい区間から流す（動画の終わりを越えないようにする）
    const loud = song.sections.reduce((p, s) => ((s.energy ?? -Infinity) > (p.energy ?? -Infinity) ? s : p), song.sections[0]);
    const from = Math.max(0, Math.min(loud?.start ?? 0, videoDuration - offset - CAPTURE_SECONDS - 3));
    setAuto({ busy: true, sec: 0 });
    try {
      const clip = await captureTab({
        seconds: CAPTURE_SECONDS,
        start: () => video.play(from),
        stop: () => video.pause(),
        videoTime: () => video.videoTime,
        onProgress: (sec) => setAuto({ busy: true, sec }),
      });
      let peak = 0;
      for (const x of clip.samples) peak = Math.max(peak, Math.abs(x));
      if (peak < 1e-3) throw new Error('動画の音が取り込めませんでした。動画がミュート・音量 0 になっていないか確かめてください');
      const m = locateClip(mono(audio.buffer), audio.buffer.sampleRate, clip.samples, clip.sampleRate);
      if (!m || !m.sure) throw new Error('動画の音が音源ファイルと一致しませんでした。別のバージョンの音源・動画かもしれません。手で合わせてください');
      // 動画の時刻 = 構成表の時刻 + ずれ、音源ファイルの時刻 = 構成表の時刻 + audio.offset
      const x = clampOffset(clip.videoStart - m.at + audio.offset);
      onChange(x);
      setAuto({ busy: false, ok: `ずれを ${x.toFixed(2)}秒にしました。区間の「ここから再生」で確かめ、ずれが残っていれば 0.1秒ずつ動かして詰めてください。` });
    } catch (e) {
      setAuto({ busy: false, error: (e as Error).message || '自動で合わせられませんでした' });
    }
  }
  const sec = song.sections.find((s) => s.id === target) ?? song.sections[0];
  // 前後の余りを除いても長さが合わなければ、途中に演出が入るなど別バージョンの動画のことがある
  const lengthDiff = song.sections.length ? videoDuration - offset - song.duration : 0;
  return (
    <details class="more yt-align" open={offset !== 0 || Math.abs(lengthDiff) > 1.5}>
      <summary>音源とのずれを合わせる（{describe(offset)}）</summary>
      <p class="sub">曲頭の無音や MV の前置きの長さが音源と違うと、区間の位置が全体にずれます。合わせる区間を番号（下の構成の番号）で選び、動画を聴いてその区間が始まった瞬間に押してください。</p>
      {video && audio && canCaptureTab() && (
        <div class="actions">
          <button class="small primary" disabled={auto.busy} onClick={() => void autoAlign()}>タブの音で自動で合わせる</button>
          <span class="sub">
            {auto.busy
              ? `動画を流して音を取り込んでいます…（${Math.floor(auto.sec ?? 0)} / ${CAPTURE_SECONDS}秒）`
              : `共有の確認で「このタブ」と「タブの音声も共有する」を選んでください。動画を${CAPTURE_SECONDS}秒流して音源ファイルと比べます（パソコンの Chrome・Edge）`}
          </span>
        </div>
      )}
      {auto.ok && <p class="ok">{auto.ok}</p>}
      {auto.error && <p class="error">{auto.error}</p>}
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
