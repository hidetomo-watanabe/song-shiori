// 開発用：librosa 等で 22050Hz モノラル float32 に変換した生データを解析して表示する
import { readFileSync } from 'node:fs';
import { analyze } from '../web/src/analysis/core.ts';

const buf = readFileSync(process.argv[2]);
const y = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const t0 = performance.now();
const r = analyze(y, 22050, undefined, process.argv[3] ? { bpm: Number(process.argv[3]) } : {}); // 第2引数で BPM を指定できる
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
console.log(`処理 ${((performance.now() - t0) / 1000).toFixed(1)}秒 / BPM ${r.bpm} / 小節頭 ${r.firstDownbeat?.toFixed(2)} / 不確か ${r.beatsUncertain} / 拍 ${r.beats.length}`);
const bar = r.bpm ? (60 / r.bpm) * 4 : 0;
for (const s of r.segments) console.log(`${fmt(s.start)} - ${fmt(s.end)}  ${s.group}  ${bar ? ((s.end - s.start) / bar).toFixed(1) : '-'}小節`);
