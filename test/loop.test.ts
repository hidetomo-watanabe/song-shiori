import { describe, expect, it } from 'vitest';
import { loopSamples } from '../web/src/audio/player';

describe('ループのつなぎ目', () => {
  // 1kHz の正弦波（44.1kHz）。区間の長さを周期の整数倍にしないと、そのままつなぐと波形が飛ぶ
  const sr = 44100;
  const wave = Float32Array.from({ length: sr * 2 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / sr));
  const s = 1000, e = s + 30145; // 周期のほぼ半端な長さ
  const step = Math.abs(wave[1] - wave[0]) * 1.5; // 隣り合うサンプルの差として自然な大きさ

  it('そのままつなぐと、終わりから頭へ戻るところで波形が飛ぶ', () => {
    const raw = wave.slice(s, e);
    expect(Math.abs(raw[0] - raw[raw.length - 1])).toBeGreaterThan(step);
  });

  it('クロスフェードすると、つなぎ目の差が普通の隣り合うサンプル程度になる', () => {
    const looped = loopSamples(wave, s, e, Math.floor(0.03 * sr));
    expect(looped.length).toBe(e - s);
    expect(Math.abs(looped[0] - looped[looped.length - 1])).toBeLessThan(step);
    // クロスフェードの後ろは元の音のまま
    expect(looped[5000]).toBe(wave[s + 5000]);
  });

  it('曲の最後まで続く区間は、後ろの音がない分を無音として重ねる', () => {
    const looped = loopSamples(wave, wave.length - 1000, wave.length, 100);
    expect(looped.length).toBe(1000);
    expect(Number.isFinite(looped[0])).toBe(true);
  });
});
