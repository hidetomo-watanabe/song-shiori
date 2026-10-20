// 検証音源フォルダの全曲を自動解析し、正解ファイル（曲名.txt。曲のしおりの「テキストで保存」の形式）と比べる（要件定義書 14章）。
//   node scripts/evaluate.ts [検証音源フォルダ]
// 音源の読み込みには Python の librosa を使う（変換結果は一時フォルダにキャッシュする）。
// 正解ファイルの BPM がある場合は、ネット上の BPM の代わりに倍・半分の判定に使った結果も示す（画面と同じ動き）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { analyze, ANALYSIS_SR } from '../web/src/analysis/core.ts';
import { octaveByReference, songFromAnalysis, suggestNames, type Song } from '../shared/song.ts';
import { parseTruth, type Truth } from '../shared/truth.ts';

const folder = process.argv[2] ?? join(import.meta.dirname, '../../../whathides/曲のしおり/検証音源');
const cacheDir = join(tmpdir(), 'song-shiori-eval');
mkdirSync(cacheDir, { recursive: true });
const TOLERANCE = 2; // 区切りの一致とみなす幅（秒）
const LABELS = ['イントロ', 'Aメロ', 'Bメロ', 'サビ', '間奏', 'アウトロ'];

function decode(file: string): Float32Array {
  const cache = join(cacheDir, `${basename(file)}.${statSync(file).mtimeMs}.f32`);
  if (!existsSync(cache)) {
    execFileSync('python3', ['-c', `import sys, librosa, numpy
y, _ = librosa.load(sys.argv[1], sr=${ANALYSIS_SR}, mono=True)
y.astype(numpy.float32).tofile(sys.argv[2])`, file, cache], { stdio: ['ignore', 'ignore', 'ignore'] });
  }
  const b = readFileSync(cache);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%（${a}/${b}）` : '—');
// 「サビ（2回目）」「Aメロ2」などを「サビ」「Aメロ」にそろえる
const baseName = (n: string) => n.replace(/（.*?）|\(.*?\)/g, '').replace(/[0-9０-９]+$/, '').trim();

function evaluate(song: Song, truth: Truth) {
  const res: string[] = [];
  const bpm = song.bpmManual ?? song.bpmEst;
  if (truth.bpm && bpm) {
    const f = octaveByReference(bpm, truth.bpm, 0.04);
    res.push(`BPM ${bpm}（正解 ${truth.bpm}・差 ${(((bpm - truth.bpm) / truth.bpm) * 100).toFixed(1)}%${f === 2 ? '・半分に誤認' : f === 0.5 ? '・倍に誤認' : f == null ? '・不一致' : ''}）`);
  }
  // 区切り：正解の区切りのうち、±2秒以内に自動の区切りがある割合（見逃しの少なさ）と、正解に当たる自動の区切りの割合（余計な区切りの少なさ）
  const tb = truth.sections.slice(1).map((s) => s.start);
  const ab = song.sections.slice(1).map((s) => s.start);
  const hitT = tb.filter((t) => ab.some((a) => Math.abs(a - t) <= TOLERANCE)).length;
  const hitA = ab.filter((a) => tb.some((t) => Math.abs(a - t) <= TOLERANCE)).length;
  res.push(`区切り：正解のうち当たり ${pct(hitT, tb.length)}・自動のうち当たり ${pct(hitA, ab.length)}`);
  // 小節数：正解の区間と始まり・終わりが ±2秒以内で重なる自動の区間について、小節数が一致した割合
  let barsOk = 0, barsN = 0;
  const barsNg: string[] = [];
  for (const t of truth.sections) {
    if (t.bars == null) continue;
    const a = song.sections.find((s) => Math.abs(s.start - t.start) <= TOLERANCE && Math.abs(s.end - t.end) <= TOLERANCE);
    if (!a) continue;
    barsN++;
    const n = a.barsManual ?? a.barsEst;
    if (n === t.bars) barsOk++; else barsNg.push(`${fmt(t.start)} ${t.name} 正解${t.bars}・自動${n ?? '未確定'}`);
  }
  res.push(`小節数（区間が一致したもの）：一致 ${pct(barsOk, barsN)}${barsNg.length ? `  ずれ：${barsNg.slice(0, 5).join(' / ')}` : ''}`);
  // 名前の候補：正解の区間の中央にある自動の区間の候補が、正解の区間名と一致した割合
  const hints = suggestNames(song);
  let nameOk = 0, nameN = 0;
  const confusion = new Map<string, number>();
  for (const t of truth.sections) {
    const label = baseName(t.name);
    if (!LABELS.includes(label)) continue;
    const mid = (t.start + t.end) / 2;
    const a = song.sections.find((s) => mid >= s.start && mid < s.end);
    const guess = a ? hints[a.id] ?? '候補なし' : '候補なし';
    nameN++;
    if (guess === label) nameOk++;
    else confusion.set(`${label}→${guess}`, (confusion.get(`${label}→${guess}`) ?? 0) + 1);
  }
  res.push(`名前の候補：一致 ${pct(nameOk, nameN)}${confusion.size ? `  外れ：${[...confusion].map(([k, v]) => `${k}×${v}`).join(' / ')}` : ''}`);
  return { lines: res, hitT, tb: tb.length, hitA, ab: ab.length, barsOk, barsN, nameOk, nameN };
}

const files = existsSync(folder) ? readdirSync(folder).filter((f) => /\.(mp3|wav|m4a|mp4|aac)$/i.test(f)).sort() : [];
if (!files.length) {
  console.log(`音源が見つかりません：${folder}`);
  process.exit(1);
}
const sum = { hitT: 0, tb: 0, hitA: 0, ab: 0, barsOk: 0, barsN: 0, nameOk: 0, nameN: 0 };
for (const f of files) {
  const name = basename(f, extname(f));
  const truthFile = join(folder, `${name}.txt`);
  const truth = existsSync(truthFile) ? parseTruth(readFileSync(truthFile, 'utf8')) : null;
  const y = decode(join(folder, f));
  let song = songFromAnalysis(analyze(y, ANALYSIS_SR));
  const raw = song.bpmEst;
  // 画面と同じく、参考の BPM（ここでは正解の BPM）から倍・半分を判定して作り直す
  const f2 = truth?.bpm && raw ? octaveByReference(raw, truth.bpm) : null;
  if (f2 === 2 || f2 === 0.5) song = songFromAnalysis(analyze(y, ANALYSIS_SR, undefined, { bpm: Math.round(raw! * f2 * 10) / 10 }));
  const parts = song.sections.filter((s) => !s.silence);
  console.log(`\n■ ${name}`);
  console.log(`  推定 BPM ${raw}${f2 === 2 || f2 === 0.5 ? ` → 参考の BPM で ${song.bpmEst} に修正` : ''} / 区間 ${parts.length} / 最長 ${Math.max(...parts.map((s) => s.barsEst ?? 0))}小節`);
  if (!truth || !truth.sections.length) {
    console.log('  正解ファイルがない（または区間が書かれていない）ため、判定はしません');
    continue;
  }
  const r = evaluate(song, truth);
  for (const l of r.lines) console.log(`  ${l}`);
  for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r[k];
}
if (sum.tb || sum.nameN || sum.barsN) {
  console.log('\n■ 全体');
  console.log(`  区切り：正解のうち当たり ${pct(sum.hitT, sum.tb)}・自動のうち当たり ${pct(sum.hitA, sum.ab)}`);
  console.log(`  小節数：一致 ${pct(sum.barsOk, sum.barsN)}`);
  console.log(`  名前の候補：一致 ${pct(sum.nameOk, sum.nameN)}`);
}
