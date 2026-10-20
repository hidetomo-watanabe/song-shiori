// 開発用：小節の数え方（解析で見つけた拍に沿う／BPM から等間隔）で、区間の小節数を比べる
import { readFileSync } from 'node:fs';
import { analyze } from '../web/src/analysis/core.ts';
import { barLines, normalize, songFromAnalysis } from '../shared/song.ts';

const b = readFileSync(process.argv[2]);
const r = analyze(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), 22050);
const byBeats = songFromAnalysis(r);
const uniform = normalize({ ...byBeats, beats: null });
const iv = r.beats.slice(1).map((x, i) => x - r.beats[i]);
const q = (p: number) => [...iv].sort((a, c) => a - c)[Math.floor(iv.length * p)];
console.log(`BPM ${r.bpm} / 拍の間隔 10%=${q(0.1).toFixed(3)} 中央=${q(0.5).toFixed(3)} 90%=${q(0.9).toFixed(3)}秒`);
const lines = barLines(byBeats)!, flat = barLines(uniform)!;
const near = (t: number, ls: number[]) => Math.min(...ls.map((x) => Math.abs(x - t)));
const frac = (s: { start: number; end: number }, ls: number[]) => {
  const i0 = ls.findIndex((x) => x > s.start) , i1 = ls.findIndex((x) => x > s.end);
  return i1 - i0;
};
for (const [i, s] of byBeats.sections.entries()) {
  const u = uniform.sections[i];
  console.log(`${s.name.padEnd(12)} ${s.start.toFixed(1).padStart(6)}〜${s.end.toFixed(1).padStart(6)}  拍に沿う=${String(s.barsEst).padStart(3)}  等間隔=${String(u.barsEst).padStart(3)}  区切りと最寄りの線のずれ: 拍=${near(s.start, lines).toFixed(2)}s 等間隔=${near(s.start, flat).toFixed(2)}s`);
}
