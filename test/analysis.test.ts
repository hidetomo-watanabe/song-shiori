import { describe, expect, it } from 'vitest';
import { analyze } from '../web/src/analysis/core';
import { songFromAnalysis } from '../shared/song';

// 合成音源：120BPM・4/4（1小節2秒）。曲頭に無音3秒、各8小節で A-B-A-C-A、曲末に無音4秒
function synth(): Float32Array {
  const sr = 22050, beat = 0.5, lead = 3, tail = 4;
  const parts: [string, number][] = [['A', 8], ['B', 8], ['A', 8], ['C', 8], ['A', 8]];
  const chords: Record<string, number[]> = { A: [261.6, 329.6, 392.0], B: [174.6, 220.0, 261.6], C: [196.0, 246.9, 293.7] };
  const y = new Float32Array((80 + lead + tail) * sr);
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let t0 = lead;
  for (const [g, bars] of parts) {
    const len = bars * 4 * beat;
    for (let i = Math.floor(t0 * sr); i < Math.floor((t0 + len) * sr); i++) {
      const t = i / sr, local = t - t0, bt = local % beat, bi = Math.floor(local / beat) % 4;
      let v = 0;
      for (const f of chords[g]) v += 0.08 * Math.sin(2 * Math.PI * f * t) * (g === 'C' ? 1.6 : 1);
      if (bi % 2 === 0 && bt < 0.12) v += (bi === 0 ? 0.8 : 0.4) * Math.sin(2 * Math.PI * (60 + 60 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 25);
      if (bt < 0.03) v += 0.15 * rand() * Math.exp(-bt * 120);
      if (g === 'B' && bi % 2 === 1 && bt < 0.08) v += 0.3 * rand() * Math.exp(-bt * 40);
      y[i] = v;
    }
    t0 += len;
  }
  return y;
}

describe('自動解析（合成音源）', () => {
  const r = analyze(synth(), 22050);
  const song = songFromAnalysis(r);

  it('テンポ・無音・区切り・繰り返しを正しく推定する', () => {
    expect(r.bpm).toBeCloseTo(120, 0);
    expect(r.leadingSilence).toBeCloseTo(3, 0);
    expect(r.trailingSilence).toBeCloseTo(4, 0);
    const parts = song.sections.filter((s) => !s.silence);
    expect(parts.map((s) => s.barsEst)).toEqual([8, 8, 8, 8, 8]);
    expect(parts.map((s) => s.group)).toEqual(['A', 'B', 'A', 'C', 'A']);
    parts.slice(1).forEach((s, i) => expect(s.start).toBeCloseTo(3 + 16 * (i + 1), 0));
  });

  it('区切りは4小節の格子の上にある', () => {
    const lines = song.sections.filter((s) => !s.silence).map((s) => s.barsEst ?? 0);
    expect(lines.every((n) => n % 4 === 0)).toBe(true);
  });
});
