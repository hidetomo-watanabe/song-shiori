// 開発用：曲頭の無音の検出結果を表示する（22050Hz モノラル float32 の生データ）
import { readFileSync } from 'node:fs';
import { analyze } from '../web/src/analysis/core.ts';

for (const f of process.argv.slice(2)) {
  const b = readFileSync(f);
  const r = analyze(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), 22050);
  console.log(f.split('/').pop(), '曲頭の無音', r.leadingSilence, '秒 / 最初の小節頭', r.firstDownbeat?.toFixed(2), '/ 最初の区切り', r.segments[0].end.toFixed(1));
}
