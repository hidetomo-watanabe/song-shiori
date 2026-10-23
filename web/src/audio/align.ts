// 取り込んだ音（YouTube の動画の一部）が、音源ファイルの何秒目にあたるかを探す。
// 音量や音質の違いに左右されないよう、波形ではなく音の立ち上がり（打音の強さの増え方）の並びを比べる

// 立ち上がりの強さの列（rate 個／秒）。各コマの高域の音量（対数）の増えた分
export function onsetEnvelope(x: Float32Array, sr: number, rate: number): Float32Array {
  const n = Math.floor((x.length / sr) * rate);
  const level = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    // コマの区切りは小数で計算する（44100 / 200 のように割り切れないと、長い曲で位置がずれていくため）
    const a = Math.max(1, Math.round((k * sr) / rate)), b = Math.min(x.length, Math.round(((k + 1) * sr) / rate));
    let e = 0;
    for (let i = a; i < b; i++) { const d = x[i] - x[i - 1]; e += d * d; } // 差分を取って高域を強める
    level[k] = Math.log(1e-10 + e / Math.max(1, b - a));
  }
  const out = new Float32Array(n);
  for (let k = 1; k < n; k++) out[k] = Math.max(0, level[k] - level[k - 1]);
  return out;
}

// 短い列 b を長い列 a の上でずらし、形がいちばん似ている位置を探す（正規化した相互相関）。
// from〜to の位置だけを調べる。score：似ている度合い（-1〜1）、second：best から guard 以上離れた位置での最大
function bestLag(a: Float32Array, b: Float32Array, from: number, to: number, guard: number) {
  const m = b.length;
  let mb = 0;
  for (let i = 0; i < m; i++) mb += b[i];
  mb /= m;
  const bc = new Float32Array(m);
  let nb = 0;
  for (let i = 0; i < m; i++) { bc[i] = b[i] - mb; nb += bc[i] * bc[i]; }
  nb = Math.sqrt(nb);
  // a の区間の和・二乗和を累積和で求める
  const s1 = new Float64Array(a.length + 1), s2 = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) { s1[i + 1] = s1[i] + a[i]; s2[i + 1] = s2[i] + a[i] * a[i]; }
  const lo = Math.max(0, from), hi = Math.min(a.length - m, to);
  const scores = new Float32Array(Math.max(0, hi - lo + 1));
  for (let lag = lo; lag <= hi; lag++) {
    let dot = 0;
    for (let i = 0; i < m; i++) dot += a[lag + i] * bc[i];
    const sum = s1[lag + m] - s1[lag], sq = s2[lag + m] - s2[lag];
    const na = Math.sqrt(Math.max(0, sq - (sum * sum) / m));
    scores[lag - lo] = na > 0 && nb > 0 ? dot / (na * nb) : 0;
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  let second = -1;
  for (let i = 0; i < scores.length; i++) if (Math.abs(i - best) > guard && scores[i] > second) second = scores[i];
  return { lag: lo + best, score: scores[best] ?? 0, second };
}

export type Match = {
  at: number; // 取り込んだ音の頭が、音源ファイルの何秒目にあたるか
  score: number; // 似ている度合い（0〜1）
  sure: boolean; // ほかの位置より、はっきり似ているか
};

// 取り込んだ音 clip（srClip）が、音源ファイル song（srSong）の何秒目から始まるかを探す。
// 0.01秒刻みで全体から探し、見つけた位置の前後を 0.001秒刻みで詰める
export function locateClip(song: Float32Array, srSong: number, clip: Float32Array, srClip: number): Match | null {
  const COARSE = 100, FINE = 1000;
  const a = onsetEnvelope(song, srSong, COARSE), b = onsetEnvelope(clip, srClip, COARSE);
  if (b.length < COARSE * 3 || a.length < b.length) return null;
  // サビの繰り返しなど似た所がほかにもあるので、0.5秒以上離れた2番目と比べてはっきりしているかを見る
  const coarse = bestLag(a, b, 0, a.length - b.length, COARSE / 2);
  if (coarse.score <= 0) return null;
  const fa = onsetEnvelope(song, srSong, FINE), fb = onsetEnvelope(clip, srClip, FINE);
  const c = coarse.lag * (FINE / COARSE), span = FINE / COARSE * 2;
  const fine = bestLag(fa, fb, c - span, c + span, 0);
  return {
    at: fine.lag / FINE,
    score: coarse.score,
    sure: coarse.score >= 0.3 && coarse.score >= coarse.second * 1.25,
  };
}

// 音声の全チャンネルを平均して1本にする
export function mono(buf: { numberOfChannels: number; length: number; getChannelData(c: number): Float32Array }): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}
