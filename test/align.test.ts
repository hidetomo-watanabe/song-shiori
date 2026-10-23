import { describe, expect, it } from 'vitest';
import { locateClip } from '../web/src/audio/align';

// 決まった種から作る乱数（テストの結果を毎回同じにする）
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// 不規則な間隔で打音（減衰する雑音）が鳴る、長さ sec 秒の音
function hits(sec: number, sr: number, seed: number): Float32Array {
  const r = rng(seed);
  const x = new Float32Array(Math.floor(sec * sr));
  for (let t = 0.3; t < sec; t += 0.12 + r() * 0.4) {
    const at = Math.floor(t * sr), amp = 0.2 + r() * 0.8;
    for (let i = 0; i < sr * 0.08 && at + i < x.length; i++) x[at + i] += amp * (r() * 2 - 1) * Math.exp(-i / (sr * 0.015));
  }
  return x;
}

// from 秒から len 秒を、別のサンプリング周波数 sr2 で取り出す（線形補間）。音量 gain、雑音 noise を加える
function clipOf(x: Float32Array, sr: number, from: number, len: number, sr2: number, gain: number, noise: number, seed: number) {
  const r = rng(seed);
  return Float32Array.from({ length: Math.floor(len * sr2) }, (_, i) => {
    const p = (from + i / sr2) * sr, k = Math.floor(p), f = p - k;
    return gain * (x[k] * (1 - f) + x[k + 1] * f) + noise * (r() * 2 - 1);
  });
}

describe('取り込んだ音の位置を音源ファイルの中から探す', () => {
  const sr = 22050;
  const song = hits(120, sr, 7);

  it('サンプリング周波数・音量が違い、雑音があっても、0.005秒以内で見つかる', () => {
    const m = locateClip(song, sr, clipOf(song, sr, 63.217, 20, 24000, 0.3, 0.01, 3), 24000)!;
    expect(m.sure).toBe(true);
    expect(Math.abs(m.at - 63.217)).toBeLessThan(0.005);
  });

  it('曲の頭のほうでも見つかる', () => {
    const m = locateClip(song, sr, clipOf(song, sr, 1.5, 15, sr, 1, 0, 1), sr)!;
    expect(Math.abs(m.at - 1.5)).toBeLessThan(0.005);
  });

  it('別の音（同じ曲にない音）は、はっきりしないとする', () => {
    const other = hits(20, sr, 99);
    const m = locateClip(song, sr, other, sr);
    expect(m?.sure ?? false).toBe(false);
  });

  it('短すぎる音は探さない', () => {
    expect(locateClip(song, sr, song.slice(0, sr), sr)).toBeNull();
  });
});
