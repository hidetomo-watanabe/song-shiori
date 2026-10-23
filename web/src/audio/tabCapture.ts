// 開いているタブの音（YouTube の動画の音）を、画面共有の機能で取り込む。パソコンの Chrome・Edge で使える。
// 取り込んだ音の頭が動画の何秒目かも求める（AudioContext の時計と動画の再生位置を並べて記録し、対応を出す）

export const canCaptureTab = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && typeof AudioWorkletNode !== 'undefined'
  && !/iPhone|iPad|Android/i.test(navigator.userAgent);

export type TabClip = { samples: Float32Array; sampleRate: number; videoStart: number };

type Options = {
  seconds: number; // 取り込む長さ
  start: () => void; // 動画の再生を始める
  stop: () => void; // 動画を止める
  videoTime: () => number; // 動画の上の再生位置（秒）
  onProgress?: (sec: number) => void;
  signal?: AbortSignal;
};

// 受け取った音をそのまま主スレッドへ送る（複数チャンネルは平均する）。currentFrame は AudioContext の時計のサンプル番号
const WORKLET = `class TabRec extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      const n = ch[0].length, m = new Float32Array(n);
      for (const c of ch) for (let i = 0; i < n; i++) m[i] += c[i] / ch.length;
      this.port.postMessage({ frame: currentFrame, data: m }, [m.buffer]);
    }
    return true;
  }
}
registerProcessor('tab-rec', TabRec);`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// 利用者の操作（クリック）から呼ぶこと。共有の確認で「このタブ」と「タブの音声も共有する」を選んでもらう
export async function captureTab(o: Options): Promise<TabClip> {
  const ctx = new AudioContext(); // 操作の直後に作らないと、音が止まったままになることがある
  let stream: MediaStream | null = null;
  try {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, audio: true,
        preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude',
      } as DisplayMediaStreamOptions);
    } catch (e) {
      const name = (e as Error)?.name ?? '';
      throw new Error(name === 'NotAllowedError' ? '共有が取り消されました' : `タブの音を取り込めませんでした（${name || '不明なエラー'}）`);
    }
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('音が共有されていません。共有の確認で「タブの音声も共有する」をオンにしてください');
    await ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }

    // 動画を流し始め、再生位置が進み出してから取り込む
    o.start();
    const t = o.videoTime();
    for (let i = 0; i < 50 && Math.abs(o.videoTime() - t) < 0.05; i++) await wait(100);
    if (Math.abs(o.videoTime() - t) < 0.05) throw new Error('動画が再生されませんでした');
    await wait(500); // 再生が落ち着くまで待つ

    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const node = new AudioWorkletNode(ctx, 'tab-rec');
    const mute = ctx.createGain();
    mute.gain.value = 0; // 処理を動かすためにつなぐだけで、音は出さない
    src.connect(node).connect(mute).connect(ctx.destination);
    const sr = ctx.sampleRate, total = Math.floor(o.seconds * sr);
    const samples = new Float32Array(total);
    let first = -1, filled = 0;
    node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => {
      if (first < 0) first = e.data.frame;
      const at = e.data.frame - first;
      if (at >= total) return;
      samples.set(e.data.data.subarray(0, total - at), at);
      filled = Math.max(filled, Math.min(total, at + e.data.data.length));
    };
    // AudioContext の時計と動画の再生位置の差を記録する（動画の時刻 = AudioContext の時刻 − 差）
    const diffs: number[] = [];
    while (filled < total) {
      if (o.signal?.aborted) throw new Error('取り消しました');
      if (track.readyState === 'ended') throw new Error('共有が止められました');
      diffs.push(ctx.currentTime - o.videoTime());
      o.onProgress?.(filled / sr);
      await wait(50);
    }
    src.disconnect();
    node.disconnect();
    if (first < 0 || diffs.length < 5) throw new Error('タブの音を取り込めませんでした');
    // 取り込んだ音の頭（AudioContext の時刻 first / sr）を、動画の時刻に直す
    return { samples, sampleRate: sr, videoStart: first / sr - median(diffs) };
  } finally {
    o.stop();
    stream?.getTracks().forEach((x) => x.stop());
    void ctx.close();
  }
}
