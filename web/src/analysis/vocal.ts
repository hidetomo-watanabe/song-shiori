// 歌の割合の推定。Spleeter（Deezer、MIT）の 2stems の歌のモデルを ONNX にしたもの（sherpa-onnx の変換）で、
// 曲の各時刻の「歌の音の大きさ ÷ 全体の音の大きさ」を求める。名前の候補で、ソロ・間奏とサビ、イントロのリフと Aメロを分ける手がかりにする。
// モデルの入力は 44.1kHz ステレオの振幅スペクトル（n_fft 4096・hop 1024 の低い 1024 ビン）を 512 フレームずつ（約12秒）に切ったもの、
// 出力は同じ形の歌の振幅。端末のメモリを使いすぎないよう、12秒ずつ作っては捨てる
import { fft } from './fft.ts';

export const VOCAL_SR = 44100;
const N_FFT = 4096, HOP = 1024, BINS = 1024, CHUNK = 512;

// [2, 1, 512, 1024]（左右・1区切り・フレーム・周波数）の振幅を受け取り、同じ形の歌の振幅を返す
export type VocalModel = (x: Float32Array) => Promise<Float32Array>;
// フレーム（1秒に fps 個）ごとの歌と全体のエネルギー（音源ファイルの時刻）
export type VocalCurve = { fps: number; vocal: Float32Array; total: Float32Array };

export async function vocalCurve(left: Float32Array, right: Float32Array, model: VocalModel, progress: (ratio: number) => void = () => {}): Promise<VocalCurve> {
  const frames = Math.floor(left.length / HOP) + 1;
  const vocal = new Float32Array(frames), total = new Float32Array(frames);
  const win = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT));
  const cos = Float64Array.from({ length: N_FFT / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / N_FFT));
  const sin = Float64Array.from({ length: N_FFT / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / N_FFT));
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  const x = new Float32Array(2 * CHUNK * BINS);
  for (let c0 = 0; c0 < frames; c0 += CHUNK) {
    x.fill(0);
    const n = Math.min(CHUNK, frames - c0);
    [left, right].forEach((y, ch) => {
      for (let f = 0; f < n; f++) {
        // フレームの中心が (c0 + f) × HOP（前後は 0 で埋める）
        const off = (c0 + f) * HOP - N_FFT / 2;
        for (let i = 0; i < N_FFT; i++) { const j = off + i; re[i] = j >= 0 && j < y.length ? y[j] * win[i] : 0; im[i] = 0; }
        fft(re, im, cos, sin);
        const base = (ch * CHUNK + f) * BINS;
        for (let k = 0; k < BINS; k++) x[base + k] = Math.hypot(re[k], im[k]);
      }
    });
    const v = await model(x);
    for (let ch = 0; ch < 2; ch++) {
      for (let f = 0; f < n; f++) {
        const base = (ch * CHUNK + f) * BINS;
        let sv = 0, st = 0;
        for (let k = 0; k < BINS; k++) { const a = x[base + k], b = Math.min(v[base + k], a); sv += b * b; st += a * a; }
        vocal[c0 + f] += sv; total[c0 + f] += st;
      }
    }
    progress(Math.min(1, (c0 + n) / frames));
  }
  return { fps: VOCAL_SR / HOP, vocal, total };
}

// 時刻 a〜b 秒（音源ファイルの時刻）の歌の割合（0〜1）
export function vocalShare(c: VocalCurve, a: number, b: number): number | undefined {
  const i0 = Math.max(0, Math.floor(a * c.fps)), i1 = Math.min(c.vocal.length, Math.ceil(b * c.fps));
  let v = 0, t = 0;
  for (let i = i0; i < i1; i++) { v += c.vocal[i]; t += c.total[i]; }
  return t > 0 ? v / t : undefined;
}
