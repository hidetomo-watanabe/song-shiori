import { describe, expect, it } from 'vitest';
import { analyze } from '../web/src/analysis/core';
import { vocalCurve, vocalShare, VOCAL_SR } from '../web/src/analysis/vocal';
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
    // 曲頭・曲末の無音は構成に入れず、曲の頭（音源ファイルの3秒目）を 0:00 にする
    expect(song.sections.some((s) => s.silence)).toBe(false);
    expect(song.audio?.offset).toBeCloseTo(3, 0);
    expect(song.duration).toBeCloseTo(80, 0);
    const parts = song.sections;
    expect(parts.map((s) => s.barsEst)).toEqual([8, 8, 8, 8, 8]);
    expect(parts.map((s) => s.group)).toEqual(['A', 'B', 'A', 'C', 'A']);
    parts.slice(1).forEach((s, i) => expect(s.start).toBeCloseTo(16 * (i + 1), 0));
  });

  it('変化の少ない長い部分も、16小節を超えるパートにしない', () => {
    // 同じ和音・同じリズムが48小節続く音源（120BPM、96秒）
    const sr = 22050, y = new Float32Array(96 * sr);
    for (let i = 0; i < y.length; i++) {
      const t = i / sr, bt = t % 0.5, bi = Math.floor(t / 0.5) % 4;
      y[i] = 0.08 * (Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t))
        + (bi % 2 === 0 && bt < 0.12 ? 0.6 * Math.sin(2 * Math.PI * 80 * bt) * Math.exp(-bt * 25) : 0);
    }
    const long = songFromAnalysis(analyze(y, 22050)).sections.filter((x) => !x.silence);
    expect(Math.max(...long.map((x) => x.barsEst ?? 0))).toBeLessThanOrEqual(16);
  });

  it('区切りは4小節の格子の上にある', () => {
    const lines = song.sections.filter((s) => !s.silence).map((s) => s.barsEst ?? 0);
    expect(lines.every((n) => n % 4 === 0)).toBe(true);
  });
});

describe('BPM を指定した解析', () => {
  it('指定が音源に合わないときは、指定なしで推定し直す', () => {
    // 120BPM の音源に 100（別の録音の値など）を指定しても、指定とも実際とも違うテンポ（以前は 91.7）にしない
    expect(analyze(synth(), 22050, undefined, { bpm: 100 }).bpm).toBeCloseTo(120, 0);
  });
});

describe('自動生成の名前', () => {
  it('名前の候補を最初から付け、手で直した区間とはみなさない', () => {
    const song = songFromAnalysis(analyze(synth(), 22050));
    expect(song.sections.map((s) => s.name)).toEqual(['サビ（1回目）', '間奏', 'サビ（2回目）', '間奏', 'サビ（3回目）']);
    expect(song.sections.every((s) => s.nameAuto && !s.edited)).toBe(true);
  });
});

describe('コードの推定', () => {
  it('合成音源の和音（C・F・G）を区間ごとに当てる', () => {
    const r = analyze(synth(), 22050);
    // A=C、B=F、A=C、C=G、A=C の順（曲頭の無音には拍がないので、最初のコードは音の始まりから）
    expect(r.chords!.map((c) => c.chord)).toEqual(['C', 'F', 'C', 'G', 'C']);
    expect(r.chords!.map((c) => Math.round(c.t))).toEqual([3, 19, 35, 51, 67]);
  });
});

describe('歌の割合', () => {
  it('モデルの出した歌の振幅から、時刻ごとの歌の割合を求め、区間に付ける', async () => {
    // 44.1kHz ステレオ・20秒。前半10秒だけ「歌」とし、モデルの代わりに、前半は振幅の半分（エネルギー 1/4）・後半は 0 を返す
    const sr = VOCAL_SR, n = 20 * sr;
    const l = Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / sr) * 0.5), r = l.slice();
    let chunk = 0;
    const curve = await vocalCurve(l, r, async (x) => {
      const fps = sr / 1024, start = chunk++ * 512;
      return x.map((v, k) => (start + Math.floor((k % (512 * 1024)) / 1024) < 10 * fps ? v / 2 : 0));
    });
    expect(vocalShare(curve, 1, 9)).toBeCloseTo(0.25, 2);
    expect(vocalShare(curve, 11, 19)).toBe(0);
    // 解析に渡すと、区間ごとの歌の割合になる（歌の割合が分からない時刻だけの区間には付けない）
    const res = analyze(synth(), 22050, undefined, { vocals: curve });
    expect(res.segments[0].vocal).toBeGreaterThan(0);
    expect(res.segments[res.segments.length - 1].vocal).toBeUndefined();
  });
});
