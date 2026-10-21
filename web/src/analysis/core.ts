// 端末内の自動解析（試作版）。外部ライブラリを使わず、次の順で推定する。
//   1. 短時間フーリエ変換 → メル帯域のエネルギー・クロマ
//   2. スペクトルの増加量（オンセット）からテンポと拍位置を推定（動的計画法）
//   3. 低音の立ち上がりと和音の変化から小節頭を推定
//   4. 小節ごとの特徴量の自己類似行列から、区切り（新規性の山）と繰り返しを推定
//   5. 拍ごとのクロマを和音の型と照らし合わせ、コードを推定
import type { AnalysisResult } from '../../../shared/song';

export const ANALYSIS_VERSION = 'proto-0.5'; // 0.2：区切りを4小節の格子から選ぶ、0.3：16小節を超えるパートを分ける、0.4：繰り返しの並びで区切りを補う、0.5：コードを推定
export const ANALYSIS_SR = 22050;

const N_FFT = 2048;
const HOP = 512;
const N_MEL = 40;

type Progress = (ratio: number, stage: string) => void;

function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half, wr = cos[k * step], wi = sin[k * step];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

function melFilters(sr: number) {
  const bins = N_FFT / 2 + 1;
  const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
  const hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const lo = mel(30), hi = mel(Math.min(8000, sr / 2));
  const edges = Array.from({ length: N_MEL + 2 }, (_, i) => hz(lo + ((hi - lo) * i) / (N_MEL + 1)));
  const binHz = sr / N_FFT;
  return Array.from({ length: N_MEL }, (_, m) => {
    const w = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const f = k * binHz;
      if (f > edges[m] && f < edges[m + 2]) {
        w[k] = f <= edges[m + 1] ? (f - edges[m]) / (edges[m + 1] - edges[m]) : (edges[m + 2] - f) / (edges[m + 2] - edges[m + 1]);
      }
    }
    return { w, center: edges[m + 1] };
  });
}

type Features = { frames: number; fps: number; mel: Float32Array; chroma: Float32Array; onset: Float32Array; low: Float32Array };

function extract(y: Float32Array, sr: number, progress: Progress): Features {
  const frames = Math.max(0, Math.floor((y.length - N_FFT) / HOP) + 1);
  const bins = N_FFT / 2 + 1;
  const win = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
  const cos = Float64Array.from({ length: N_FFT / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / N_FFT));
  const sin = Float64Array.from({ length: N_FFT / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / N_FFT));
  const filters = melFilters(sr);
  const pitchClass = Int8Array.from({ length: bins }, (_, k) => {
    const f = (k * sr) / N_FFT;
    if (f < 55 || f > 4000) return -1;
    return ((Math.round(12 * Math.log2(f / 440)) % 12) + 12 + 9) % 12; // 0 = C
  });
  const mel = new Float32Array(frames * N_MEL);
  const chroma = new Float32Array(frames * 12);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT), power = new Float64Array(bins);
  for (let t = 0; t < frames; t++) {
    const off = t * HOP;
    for (let i = 0; i < N_FFT; i++) { re[i] = y[off + i] * win[i]; im[i] = 0; }
    fft(re, im, cos, sin);
    for (let k = 0; k < bins; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
      const pc = pitchClass[k];
      if (pc >= 0) chroma[t * 12 + pc] += Math.sqrt(power[k]);
    }
    for (let m = 0; m < N_MEL; m++) {
      const w = filters[m].w;
      let e = 0;
      for (let k = 0; k < bins; k++) if (w[k]) e += w[k] * power[k];
      mel[t * N_MEL + m] = 10 * Math.log10(1e-10 + e);
    }
    if (t % 500 === 0) progress((t / frames) * 0.6, '音の特徴を抽出しています');
  }
  // 最大値から80dB以下は切り捨てる
  let max = -Infinity;
  for (const v of mel) if (v > max) max = v;
  for (let i = 0; i < mel.length; i++) mel[i] = Math.max(mel[i], max - 80);

  const lowBands = filters.filter((f) => f.center < 200).length;
  const onset = new Float32Array(frames), low = new Float32Array(frames);
  for (let t = 1; t < frames; t++) {
    let all = 0, lo = 0;
    for (let m = 0; m < N_MEL; m++) {
      const d = mel[t * N_MEL + m] - mel[(t - 1) * N_MEL + m];
      if (d > 0) { all += d; if (m < lowBands) lo += d; }
    }
    onset[t] = all;
    low[t] = lo;
  }
  return { frames, fps: sr / HOP, mel, chroma, onset: detrend(onset, Math.round(sr / HOP)), low: detrend(low, Math.round(sr / HOP)) };
}

// 約1秒の移動平均を引いて正規化する
function detrend(x: Float32Array, w: number): Float32Array {
  const out = new Float32Array(x.length);
  let sum = 0;
  const q: number[] = [];
  for (let i = 0; i < x.length; i++) {
    q.push(x[i]); sum += x[i];
    if (q.length > w) sum -= q.shift()!;
    out[i] = Math.max(0, x[i] - sum / q.length);
  }
  let sq = 0;
  for (const v of out) sq += v * v;
  const sd = Math.sqrt(sq / Math.max(1, out.length)) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= sd;
  return out;
}

// 自己相関からテンポ（1拍のフレーム数）を推定。120BPM付近を優先する。
// BPM の指定（ネット上の情報や手入力）があれば、その ±4% の範囲で探す
function estimatePeriod(onset: Float32Array, fps: number, bpmHint?: number): number {
  const center = bpmHint ? (60 * fps) / bpmHint : 0;
  const minLag = Math.max(2, bpmHint ? Math.floor(center * 0.96) : Math.floor((60 * fps) / 200));
  const maxLag = Math.min(onset.length - 2, bpmHint ? Math.ceil(center * 1.04) : Math.ceil((60 * fps) / 60));
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let t = 0; t + lag < onset.length; t++) s += onset[t] * onset[t + lag];
    ac[lag] = s / Math.max(1, onset.length - lag);
  }
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = bpmHint ? 1 : Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = ac[lag] * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  const a = ac[best - 1], b = ac[best], c = ac[best + 1];
  const denom = a - 2 * b + c;
  return best + (denom ? (0.5 * (a - c)) / denom : 0);
}

// 動的計画法による拍追跡（Ellis 2007）
function trackBeats(onset: Float32Array, period: number): number[] {
  const n = onset.length, tightness = 100;
  const score = new Float64Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let best = -Infinity, arg = -1;
    for (let p = t - hi; p <= t - lo; p++) {
      if (p < 0) continue;
      const s = score[p] - tightness * Math.log((t - p) / period) ** 2;
      if (s > best) { best = s; arg = p; }
    }
    score[t] = onset[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  let end = n - 1;
  for (let t = Math.max(0, n - Math.round(period * 2)); t < n; t++) if (score[t] > score[end]) end = t;
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) beats.push(t);
  beats.reverse();
  // 曲頭・曲末の無音部分の拍を落とす
  const strong = beats.map((b) => onset[b]).sort((x, y) => x - y);
  const floor = (strong[Math.floor(strong.length / 2)] ?? 0) * 0.15;
  let i = 0, j = beats.length - 1;
  while (i < j && localMax(onset, beats[i], period) < floor) i++;
  while (j > i && localMax(onset, beats[j], period) < floor) j--;
  return beats.slice(i, j + 1);
}

// 拍の間隔はフレーム単位で丸められるため、拍の番号と時刻の最小二乗直線の傾きから1拍の長さを求める
function fitPeriod(beats: number[], median: number): number {
  const idx: number[] = [0];
  for (let i = 1; i < beats.length; i++) idx.push(idx[i - 1] + Math.max(1, Math.round((beats[i] - beats[i - 1]) / median)));
  const n = beats.length;
  const mx = idx.reduce((p, v) => p + v, 0) / n, my = beats.reduce((p, v) => p + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (idx[i] - mx) * (beats[i] - my); sxx += (idx[i] - mx) ** 2; }
  return sxx ? sxy / sxx : median;
}

function localMax(x: Float32Array, at: number, period: number) {
  let m = 0;
  for (let k = Math.max(0, at - Math.round(period / 2)); k <= Math.min(x.length - 1, at + Math.round(period / 2)); k++) m = Math.max(m, x[k]);
  return m;
}

function meanVector(x: Float32Array, dim: number, from: number, to: number): Float64Array {
  const v = new Float64Array(dim);
  const n = Math.max(1, to - from);
  for (let t = from; t < to; t++) for (let d = 0; d < dim; d++) v[d] += x[t * dim + d];
  for (let d = 0; d < dim; d++) v[d] /= n;
  return v;
}

function unit(v: Float64Array): Float64Array {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

const dot = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

// 小節頭の位相（拍の何番目から数えるか）を、低音の立ち上がりと和音の変化で選ぶ
function downbeatPhase(beats: number[], f: Features, beatsPerBar: number): number {
  let best = 0, bestScore = -Infinity;
  const change = beats.map((b, i) => {
    if (i === 0 || i === beats.length - 1) return 0;
    const before = unit(meanVector(f.chroma, 12, beats[i - 1], b));
    const after = unit(meanVector(f.chroma, 12, b, beats[i + 1]));
    return 1 - dot(before, after);
  });
  for (let phase = 0; phase < beatsPerBar; phase++) {
    let s = 0, n = 0;
    for (let i = phase; i < beats.length; i += beatsPerBar) { s += f.low[beats[i]] + 2 * change[i]; n++; }
    if (n && s / n > bestScore) { bestScore = s / n; best = phase; }
  }
  return best;
}

// 区切り単位（小節、拍が不確かなら2秒）ごとの特徴量。クロマと音色（メル）を連結する
const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// 和音の型（根音からの半音）。4和音は3和音と取り違えやすいので、はっきり鳴っているときだけ選ばれるよう少し不利にする
const CHORD_TYPES: { suffix: string; tones: number[]; prior: number }[] = [
  { suffix: '', tones: [0, 4, 7], prior: 0 },
  { suffix: 'm', tones: [0, 3, 7], prior: 0 },
  { suffix: '7', tones: [0, 4, 7, 10], prior: -0.05 },
  { suffix: 'm7', tones: [0, 3, 7, 10], prior: -0.05 },
  { suffix: 'maj7', tones: [0, 4, 7, 11], prior: -0.05 },
];
// テンプレートは平均を引いてから長さ1にする（クロマ側も同じにして相関をとる）
const centered = (v: Float64Array) => {
  const m = v.reduce((p, x) => p + x, 0) / v.length;
  return unit(v.map((x) => x - m));
};
const CHORD_TEMPLATES = CHORD_TYPES.flatMap(({ suffix, tones, prior }) => NOTES.map((root, r) => {
  const v = new Float64Array(12);
  for (const k of tones) v[(r + k) % 12] = 1;
  return { name: root + suffix, root: r, v: centered(v), prior };
}));
export const NO_CHORD = 'N';
const CHORD_CHANGE = 0.3; // コードを変えるときの減点。拍ごとの細かい揺れで変わらないようにする
const BASS_WEIGHT = 0.3; // 低音が根音と合っているときの加点

// コード用のクロマ。区切りに使うクロマ（2048点）では低音の半音を分けられないため、8192点で細かく分け、
// 低音（根音の手がかり）と中高音（和音の構成音）を別に集める。半音の中心から外れた周波数は使わない
function chordChroma(y: Float32Array, sr: number) {
  const N = 8192, hop = 2048;
  const frames = Math.max(0, Math.floor((y.length - N) / hop) + 1);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const cos = Float64Array.from({ length: N / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / N));
  const sin = Float64Array.from({ length: N / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / N));
  const bins = N / 2 + 1;
  // 0〜11：音名、-1：使わない。low：低音の帯域か
  const pc = new Int8Array(bins).fill(-1), low = new Uint8Array(bins);
  for (let k = 1; k < bins; k++) {
    const f = (k * sr) / N;
    if (f < 40 || f > 2000) continue;
    const semi = 12 * Math.log2(f / 440);
    if (Math.abs(semi - Math.round(semi)) > 0.3) continue;
    pc[k] = ((Math.round(semi) % 12) + 12 + 9) % 12;
    low[k] = f < 200 ? 1 : 0;
  }
  const bass = new Float32Array(frames * 12), treble = new Float32Array(frames * 12);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let t = 0; t < frames; t++) {
    const off = t * hop;
    for (let i = 0; i < N; i++) { re[i] = y[off + i] * win[i]; im[i] = 0; }
    fft(re, im, cos, sin);
    for (let k = 0; k < bins; k++) {
      if (pc[k] < 0) continue;
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (low[k]) bass[t * 12 + pc[k]] += m;
      else if ((k * sr) / N >= 110) treble[t * 12 + pc[k]] += m;
    }
  }
  return { frames, time: (t: number) => (t * hop + N / 2) / sr, frameAt: (sec: number) => Math.max(0, Math.round((sec * sr - N / 2) / hop)), bass, treble };
}

// 拍ごと（拍が不確かなら0.5秒ごと）のクロマを和音の型と照らし合わせ、動的計画法で並びをならしてコードを推定する。
// 戻り値はコードの変わり目（音源ファイルの秒）。N は和音なし（無音など）
function estimateChords(y: Float32Array, sr: number, beats: number[], beatsUncertain: boolean, duration: number): { t: number; chord: string }[] {
  const c = chordChroma(y, sr);
  if (c.frames < 2) return [];
  const bounds = !beatsUncertain && beats.length >= 2 ? beats : Array.from({ length: Math.floor(duration / 0.5) + 1 }, (_, i) => i * 0.5);
  const spans = bounds.slice(0, -1).map((b, i) => [c.frameAt(b), Math.max(c.frameAt(b) + 1, c.frameAt(bounds[i + 1]))] as const);
  const treble = spans.map(([a, b]) => meanVector(c.treble, 12, a, Math.min(b, c.frames)));
  const bass = spans.map(([a, b]) => meanVector(c.bass, 12, a, Math.min(b, c.frames)));
  const level = treble.map((v) => v.reduce((p, x) => p + x, 0));
  const typical = level.slice().sort((a, b) => a - b)[Math.floor(level.length / 2)] || 1;
  // 状態：各テンプレート + 和音なし
  const S = CHORD_TEMPLATES.length + 1;
  const n = spans.length;
  const score = new Float64Array(S), back: Int16Array[] = [];
  for (let i = 0; i < n; i++) {
    const quiet = level[i] < typical * 0.08;
    const v = centered(treble[i].map((x) => Math.sqrt(x)));
    const bmax = Math.max(...bass[i]) || 1;
    const emit = new Float64Array(S);
    for (let k = 0; k < CHORD_TEMPLATES.length; k++) {
      const tpl = CHORD_TEMPLATES[k];
      emit[k] = quiet ? -1 : dot(v, tpl.v) + tpl.prior + BASS_WEIGHT * (bass[i][tpl.root] / bmax);
    }
    emit[S - 1] = quiet ? 1 : 0;
    const prev = Float64Array.from(score);
    let bestPrev = 0;
    for (let k = 1; k < S; k++) if (prev[k] > prev[bestPrev]) bestPrev = k;
    const from = new Int16Array(S);
    for (let k = 0; k < S; k++) {
      const stay = prev[k], change = prev[bestPrev] - CHORD_CHANGE;
      from[k] = i && change > stay ? bestPrev : k;
      score[k] = (i ? Math.max(stay, change) : 0) + emit[k];
    }
    back.push(from);
  }
  let k = 0;
  for (let j = 1; j < S; j++) if (score[j] > score[k]) k = j;
  const path = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) { path[i] = k; k = back[i][k]; }
  const out: { t: number; chord: string }[] = [];
  path.forEach((s, i) => {
    const chord = s === S - 1 ? NO_CHORD : CHORD_TEMPLATES[s].name;
    if (out[out.length - 1]?.chord !== chord) out.push({ t: Math.round(bounds[i] * 1000) / 1000, chord });
  });
  return out;
}

function unitFeatures(f: Features, bounds: number[]): Float64Array[] {
  const melMean = new Float64Array(N_MEL), melSd = new Float64Array(N_MEL);
  for (let t = 0; t < f.frames; t++) for (let m = 0; m < N_MEL; m++) melMean[m] += f.mel[t * N_MEL + m] / f.frames;
  for (let t = 0; t < f.frames; t++) for (let m = 0; m < N_MEL; m++) melSd[m] += (f.mel[t * N_MEL + m] - melMean[m]) ** 2 / f.frames;
  for (let m = 0; m < N_MEL; m++) melSd[m] = Math.sqrt(melSd[m]) || 1;
  const out: Float64Array[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const c = unit(meanVector(f.chroma, 12, bounds[i], bounds[i + 1]));
    const m = meanVector(f.mel, N_MEL, bounds[i], bounds[i + 1]).map((v, k) => (v - melMean[k]) / melSd[k]);
    const mu = unit(m);
    const v = new Float64Array(12 + N_MEL);
    v.set(c.map((x) => x * Math.SQRT1_2), 0);
    v.set(mu.map((x) => x * Math.SQRT1_2), 12);
    out.push(v);
  }
  return out;
}

// 自己類似行列のチェッカーボード核による新規性曲線から区切りを選ぶ
function novelty(S: number[][], half: number): Float64Array {
  const n = S.length;
  const nov = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let s = 0, w = 0;
    for (let a = -half; a < half; a++) {
      for (let b = -half; b < half; b++) {
        const x = i + a, y = i + b;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const g = Math.exp(-((a + 0.5) ** 2 + (b + 0.5) ** 2) / (2 * (half / 2) ** 2));
        const sign = (a < 0) === (b < 0) ? 1 : -1;
        s += sign * g * S[x][y];
        w += g;
      }
    }
    nov[i] = w ? s / w : 0;
  }
  return nov;
}

const stats = (nov: Float64Array) => {
  const vals = Array.from(nov).slice(1);
  const mean = vals.reduce((p, v) => p + v, 0) / Math.max(1, vals.length);
  const sd = Math.sqrt(vals.reduce((p, v) => p + (v - mean) ** 2, 0) / Math.max(1, vals.length));
  return { mean, sd };
};

// 区切りを「unit 小節ごとの格子」の上だけから選ぶ。格子の起点（何小節目から数えるか）は、
// 新規性が最も多く乗るものにする（ここではずれを許さない。許すと隣の起点と同点になり取り違える）。
// 起点を決めたあとの判定では、山が格子から1小節ずれていても拾えるよう、前後1小節の最大値を使う
// threshold：格子の上の新規性が「平均 + threshold × 標準偏差」を超えたら区切る（実曲3曲で調整し 0.4）
function pickOnPhraseGrid(nov: Float64Array, unit: number, threshold: number, minGap = 4, maxLen = 16): number[] {
  const n = nov.length;
  const { mean, sd } = stats(nov);
  const score = (i: number) => Math.max(nov[i], i > 1 ? nov[i - 1] : -Infinity, i + 1 < n ? nov[i + 1] : -Infinity);
  let offset = 0, best = -Infinity;
  for (let o = 0; o < unit; o++) {
    let sum = 0;
    for (let i = o || unit; i < n; i += unit) sum += Math.max(0, nov[i] - mean);
    if (sum > best) { best = sum; offset = o; }
  }
  const grid: number[] = [];
  for (let i = offset || unit; i < n - 1; i += unit) grid.push(i);
  // 区切りらしさの強い順に選び、すでに選んだ区切りから minGap 小節未満の位置は捨てる
  const far = (i: number, chosen: number[]) => chosen.every((c) => Math.abs(c - i) >= minGap);
  const chosen: number[] = [];
  for (const i of grid.filter((i) => score(i) > mean + threshold * sd).sort((a, b) => score(b) - score(a))) if (far(i, chosen)) chosen.push(i);
  chosen.sort((a, b) => a - b);
  // 長すぎるパートは、その中で区切りらしさが最も強い格子の位置で分ける（多くのパートは16小節以内のため）
  for (let changed = true; changed;) {
    changed = false;
    const edges = [0, ...chosen, n];
    for (let k = 0; k + 1 < edges.length; k++) {
      const [a, b] = [edges[k], edges[k + 1]];
      if (b - a <= maxLen) continue;
      let at = -1, top = -Infinity;
      for (const i of grid) if (i >= a + minGap && i <= b - minGap && score(i) > top) { top = score(i); at = i; }
      if (at < 0) continue;
      chosen.push(at);
      chosen.sort((x, y) => x - y);
      changed = true;
      break;
    }
  }
  return chosen;
}

// 繰り返しの並びを使って区切りを補う。
// 小節どうしの類似度の表で、斜めに高い値が続く帯（ある部分が lag 小節後ろでもそのまま繰り返している）を探し、
// 繰り返している部分の中にある区切りを、同じだけ後ろ・前にも写す（例：1番の Bメロの区切り → 2番の Bメロの区切り）。
// 写した位置の区切りらしさが低すぎるもの（サビの中の小さな繰り返しなど）は採らない
export type RepetitionOptions = { quantile?: number; minRun?: number; minLag?: number; novFloor?: number; minGap?: number; passes?: number };
type Run = { i: number; j: number; len: number };
function findRuns(S: number[][], o: RepetitionOptions = {}): Run[] {
  const n = S.length;
  // 既定値は検証音源（ゲット・アップ・ルーシー）の正解データで調整。ほかの曲で区間の数が大きく変わらないことも確認
  const quantile = o.quantile ?? 0.7, minRun = o.minRun ?? 4, minLag = o.minLag ?? 6;
  const vals: number[] = [];
  for (let i = 0; i < n; i++) for (let j = i + minLag; j < n; j++) vals.push(S[i][j]);
  if (!vals.length) return [];
  vals.sort((a, b) => a - b);
  const thr = vals[Math.floor(vals.length * quantile)];
  // 繰り返しの帯：[i, i+len) が [i+lag, i+lag+len) で繰り返す。1小節だけの途切れは許す
  const runs: Run[] = [];
  for (let lag = minLag; lag < n - minRun; lag++) {
    let start = -1, gap = 0;
    for (let i = 0; i + lag <= n; i++) {
      const hit = i + lag < n && S[i][i + lag] >= thr;
      if (hit) { if (start < 0) start = i; gap = 0; continue; }
      if (start >= 0 && gap === 0 && i + lag < n) { gap = 1; continue; }
      if (start >= 0) {
        const end = i - gap;
        if (end - start >= minRun) runs.push({ i: start, j: start + lag, len: end - start });
      }
      start = -1; gap = 0;
    }
  }
  return runs;
}

function refineByRepetition(S: number[][], nov: Float64Array, cuts: number[], runs: Run[], o: RepetitionOptions = {}): number[] {
  const n = S.length;
  const novFloor = o.novFloor ?? 0, minGap = o.minGap ?? 3;
  const { mean, sd } = stats(nov);
  const strong = (k: number) => Math.max(nov[k] ?? -Infinity, nov[k - 1] ?? -Infinity, nov[k + 1] ?? -Infinity) >= mean + novFloor * sd;
  let result = cuts.slice();
  for (let pass = 0; pass < (o.passes ?? 2); pass++) {
    // 区切りを繰り返しで写した先と、そこを支持する数（何か所の区切りから写されたか）
    const support = new Map<number, number>();
    for (const b of result) {
      for (const r of runs) {
        const to = b > r.i && b < r.i + r.len ? b - r.i + r.j : b > r.j && b < r.j + r.len ? b - r.j + r.i : -1;
        if (to > 0 && to < n) support.set(to, (support.get(to) ?? 0) + 1);
      }
    }
    let grew = false;
    for (const [c, count] of [...support].sort((x, y) => y[1] - x[1] || nov[y[0]] - nov[x[0]])) {
      if (!strong(c) || result.includes(c)) continue;
      const near = result.filter((x) => Math.abs(x - c) < minGap);
      // 近くの区切りより多くの繰り返しから支持されていれば置き換える
      // （4小節単位で選んだ区切りが、4小節＋6小節のような並びで2小節ずれている場合など）
      if (near.length && !near.every((x) => count > (support.get(x) ?? 0))) continue;
      result = result.filter((x) => !near.includes(x));
      result.push(c);
      grew = true;
    }
    result.sort((x, y) => x - y);
    if (!grew) break;
  }
  return result;
}

function pickBoundaries(S: number[][], half: number, minGap: number, phrase: boolean): number[] {
  const n = S.length;
  const nov = novelty(S, half);
  // 小節単位のときは、4小節・8小節の区切りを優先する（多くの曲はこの単位でまとまる）
  if (phrase) {
    let lo = Infinity;
    for (let i = 1; i < n; i++) lo = Math.min(lo, nov[i]);
    for (let i = 1; i < n; i++) nov[i] = (nov[i] - lo) * (i % 8 === 0 ? 1.5 : i % 4 === 0 ? 1.3 : i % 2 === 0 ? 1.05 : 1);
  }
  const { mean, sd } = stats(nov);
  const peaks: number[] = [];
  for (let i = 2; i < n - 1; i++) {
    let isMax = true;
    for (let k = Math.max(1, i - 2); k <= Math.min(n - 1, i + 2); k++) if (nov[k] > nov[i]) isMax = false;
    if (isMax && nov[i] > mean + 0.25 * sd) peaks.push(i);
  }
  peaks.sort((a, b) => nov[b] - nov[a]);
  const chosen: number[] = [];
  for (const p of peaks) if (chosen.every((c) => Math.abs(c - p) >= minGap)) chosen.push(p);
  return chosen.sort((a, b) => a - b);
}

// 区間同士の類似度：対角線に沿った類似度の平均（±1単位のずれを許す）
function segmentSimilarity(S: number[][], a: [number, number], b: [number, number]): number {
  const la = a[1] - a[0], lb = b[1] - b[0];
  const len = Math.min(la, lb);
  let best = -Infinity;
  for (let shift = -1; shift <= 1; shift++) {
    let s = 0, n = 0;
    for (let k = 0; k < len; k++) {
      const i = a[0] + k, j = b[0] + k + shift;
      if (j < b[0] || j >= b[1]) continue;
      s += S[i][j]; n++;
    }
    if (n) best = Math.max(best, s / n);
  }
  const ratio = Math.max(la, lb) / Math.max(1, len);
  return ratio > 2 ? best * 0.85 : best;
}

// 曲頭・曲末の無音の長さ（秒）。最も大きい音から 40dB 以上小さい間を無音とみなす（0.3秒未満は 0）
function findSilence(f: Features, frameTime: (t: number) => number, duration: number): { leading: number; trailing: number } {
  const level = new Float32Array(f.frames);
  let max = -Infinity;
  for (let t = 0; t < f.frames; t++) {
    let m = -Infinity;
    for (let b = 0; b < N_MEL; b++) m = Math.max(m, f.mel[t * N_MEL + b]);
    level[t] = m;
    max = Math.max(max, m);
  }
  let first = 0;
  while (first < f.frames && level[first] < max - 40) first++;
  let last = f.frames - 1;
  while (last > first && level[last] < max - 40) last--;
  const lead = Math.max(0, frameTime(first) - 0.05);
  const trail = Math.max(0, duration - (frameTime(last) + 0.1)); // 余韻を少し残す
  const round = (x: number) => (x >= 0.3 ? Math.round(x * 100) / 100 : 0);
  return { leading: round(lead), trailing: round(trail) };
}

// opts.phrase：区切りを何小節ごとの格子から選ぶか（既定 4。0 なら格子を使わず、新規性の山から選ぶ従来の方式）
export function analyze(
  y: Float32Array, sr: number, progress: Progress = () => {},
  opts: { bpm?: number; phrase?: number; phraseThreshold?: number; minGap?: number; repetition?: RepetitionOptions | false } = {},
): AnalysisResult {
  const duration = y.length / sr;
  const f = extract(y, sr, progress);
  if (f.frames < f.fps * 10) throw new Error('音源が短すぎます（10秒以上必要です）');
  const frameTime = (t: number) => (t * HOP + N_FFT / 2) / sr;
  const silence = findSilence(f, frameTime, duration);
  let leadingSilence = silence.leading;
  const trailingSilence = silence.trailing;

  progress(0.65, 'テンポと拍を推定しています');
  const tempo = (hint?: number) => {
    const beatFrames = trackBeats(f.onset, estimatePeriod(f.onset, f.fps, hint));
    const beats = beatFrames.map(frameTime);
    const intervals = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)] ?? 0;
    const spread = intervals.length ? intervals.reduce((p, v) => p + Math.abs(v - median), 0) / intervals.length / (median || 1) : 1;
    const bpm = median ? Math.round(600 / fitPeriod(beats, median)) / 10 : null;
    return { beatFrames, beats, beatsUncertain: beats.length < 16 || spread > 0.08, bpm };
  };
  // 指定の BPM が音源に合わないと（別の録音の値など）、拍を無理に合わせて、指定とも実際とも違うテンポになる
  // （丸ノ内サディスティック：実際 99.9 に 90 を指定すると 67.5）。測ったテンポが探した範囲（±4%）から外れたら、指定なしで推定し直す
  let t = tempo(opts.bpm);
  if (opts.bpm && t.bpm && Math.abs(t.bpm / opts.bpm - 1) > 0.04) t = tempo();
  const { beatFrames, beats, beatsUncertain, bpm } = t;

  progress(0.75, '小節頭を推定しています');
  const beatsPerBar = 4;
  const phase = beatsUncertain ? 0 : downbeatPhase(beatFrames, f, beatsPerBar);
  const firstDownbeat = beatsUncertain || !beats.length ? null : beats[phase];
  // 無音の終わりが最初の小節頭とほぼ同じなら、小節頭に揃える（最初の区間の小節数がずれないように）
  if (leadingSilence && firstDownbeat != null && Math.abs(leadingSilence - firstDownbeat) < 0.25) leadingSilence = firstDownbeat;

  progress(0.85, '区切りと繰り返しを推定しています');
  // 区切り単位：小節（拍が不確かなら2秒ごと）
  let bounds: number[];
  if (!beatsUncertain) {
    bounds = beatFrames.filter((_, i) => i >= phase && (i - phase) % beatsPerBar === 0);
  } else {
    const step = Math.round(2 * f.fps);
    bounds = Array.from({ length: Math.floor(f.frames / step) + 1 }, (_, i) => i * step);
  }
  if (bounds.length < 4) bounds = [0, f.frames - 1];
  const feats = unitFeatures(f, bounds);
  const n = feats.length;
  const S = feats.map((a) => feats.map((b) => dot(a, b)));
  const phrase = opts.phrase ?? 4;
  const nov = novelty(S, 4);
  const base = n < 8 ? [] : !beatsUncertain && phrase > 0 ? pickOnPhraseGrid(nov, phrase, opts.phraseThreshold ?? 0.4, opts.minGap ?? 4) : pickBoundaries(S, 4, 4, !beatsUncertain);
  const useRuns = n >= 8 && !beatsUncertain && opts.repetition !== false;
  const runs = useRuns ? findRuns(S, opts.repetition || {}) : [];
  const cuts = useRuns ? refineByRepetition(S, nov, base, runs, opts.repetition || {}) : base;
  const unitIdx = [0, ...cuts, n];

  // 繰り返しのまとめ：曲全体で「普通より似ている」水準を超えたら同じグループ
  let sum = 0, sq = 0, cnt = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { sum += S[i][j]; sq += S[i][j] ** 2; cnt++; }
  const mean = cnt ? sum / cnt : 0;
  const sd = cnt ? Math.sqrt(Math.max(0, sq / cnt - mean * mean)) : 0;
  const threshold = mean + 0.9 * sd;
  const ranges = unitIdx.slice(0, -1).map((a, i) => [a, unitIdx[i + 1]] as [number, number]);
  const groups: { name: string; members: number[] }[] = [];
  const labels = ranges.map((r, i) => {
    let best: (typeof groups)[number] | null = null, bestScore = -Infinity;
    for (const g of groups) {
      const s = g.members.reduce((p, m) => p + segmentSimilarity(S, ranges[m], r), 0) / g.members.length;
      if (s > bestScore) { bestScore = s; best = g; }
    }
    if (best && bestScore >= threshold) { best.members.push(i); return best.name; }
    const g = { name: String.fromCharCode(65 + Math.min(groups.length, 25)), members: [i] };
    groups.push(g);
    return g.name;
  });

  // 区切り単位の位置を秒に直す。最初の区間は曲頭から、最後の区間は曲末まで
  // 各パートの音量（dB）。サビなどの名前の候補を推定する手がかりに使う
  const energyDb = (a: number, b: number) => {
    const i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(y.length, Math.ceil(b * sr));
    let sq = 0;
    for (let i = i0; i < i1; i++) sq += y[i] * y[i];
    return Math.round(10 * Math.log10(sq / Math.max(1, i1 - i0) + 1e-12) * 10) / 10;
  };
  const segments = ranges.map((r, i) => {
    const start = i === 0 ? 0 : frameTime(bounds[r[0]]);
    const end = i === ranges.length - 1 ? duration : frameTime(bounds[r[1]]);
    return { start, end, group: labels[i], energy: energyDb(Math.max(start, leadingSilence), Math.min(end, duration - trailingSilence)) };
  });
  progress(0.95, 'コードを推定しています');
  const chords = estimateChords(y, sr, beats, beatsUncertain, duration);
  progress(1, '完了');
  return { version: ANALYSIS_VERSION, duration, bpm, beats, firstDownbeat, beatsUncertain, segments, leadingSilence, trailingSilence, chords };
}
