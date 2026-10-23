// 検証音源フォルダの全曲を自動解析し、正解ファイル（曲名.txt。曲のしおりの「テキストで保存」の形式）と比べる（要件定義書 14章）。
//   node scripts/evaluate.ts [検証音源フォルダ] [--phrase 4] [--threshold 0.4]
//   --phrase / --threshold は、区切りを選ぶ小節の単位としきい値を試すためのもの（既定は画面と同じ）
// 音源の読み込みには Python の librosa を使う（変換結果は一時フォルダにキャッシュする）。
// 正解ファイルの BPM がある場合は、ネット上の BPM の代わりに倍・半分の判定に使った結果も示す（画面と同じ動き）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { analyze, ANALYSIS_SR } from '../web/src/analysis/core.ts';
import { chordAt, octaveByReference, shiftSong, songFromAnalysis, suggestNames, type Song } from '../shared/song.ts';
import { parseTruth, type Truth } from '../shared/truth.ts';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args.splice(i, 2)[1]) : undefined; };
const rep = { quantile: opt('rq'), minRun: opt('rrun'), minLag: opt('rlag'), novFloor: opt('rfloor'), minGap: opt('rgap') };
const tuning = { phrase: opt('phrase'), phraseThreshold: opt('threshold'), minGap: opt('mingap'), repetition: args.includes('--norep') ? false as const : rep };
if (args.includes('--norep')) args.splice(args.indexOf('--norep'), 1);
const folder = args[0] ?? join(import.meta.dirname, '../../../whathides/曲のしおり/検証音源');
const cacheDir = join(tmpdir(), 'song-shiori-eval');
mkdirSync(cacheDir, { recursive: true });
const TOLERANCE = 2; // 区切りの一致とみなす幅（秒）
// 名前の候補を採点する区間名。正解ファイルにこれ以外の名前（「無音」など）がある区間は数えない
const LABELS = ['イントロ前', 'イントロ', 'Aメロ', 'Bメロ', 'Cメロ', 'サビ', '間奏', 'ソロ', 'ブレイク', 'アウトロ'];

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

// コードを「根音（異名同音をそろえる）＋メジャー系かマイナー系か」にそろえる。分数コードの低音は見ない
const ROOTS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function chordClass(name: string): string | null {
  const m = name.match(/^([A-G])([#♯b♭]?)(.*)$/);
  if (!m) return null;
  const root = (ROOTS[m[1]] + (/[#♯]/.test(m[2]) ? 1 : /[b♭]/.test(m[2]) ? -1 : 0) + 12) % 12;
  const minor = /^m(?!aj)/.test(m[3].split('/')[0]);
  return `${root}${minor ? 'm' : ''}`;
}

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
  // コード：正解の「コード | Am | G |」の各コードについて、その位置（小節を等分した中央）の推定が、根音とメジャー・マイナーで一致した割合
  let chordOk = 0, chordN = 0;
  const chordNg: string[] = [];
  const barLen = truth.bpm ? (60 * (truth.beatsPerBar ?? 4)) / truth.bpm : null;
  for (const t of truth.sections) {
    if (!t.chords || !barLen || !song.chords?.length) continue;
    t.chords.split('|').map((c) => c.trim()).filter(Boolean).forEach((cell, k) => {
      const names = cell.split(/\s+/);
      names.forEach((name, j) => {
        const want = chordClass(name);
        if (!want) return;
        const at = t.start + k * barLen + ((j + 0.5) * barLen) / names.length;
        const got = chordAt(song.chords!, at) ?? 'N';
        chordN++;
        if (chordClass(got) === want) chordOk++; else chordNg.push(`${fmt(at)} 正解${name}・推定${got}`);
      });
    });
  }
  if (chordN) res.push(`コード（根音とメジャー・マイナー）：一致 ${pct(chordOk, chordN)}${chordNg.length ? `  外れ：${chordNg.slice(0, 6).join(' / ')}` : ''}`);
  return { lines: res, hitT, tb: tb.length, hitA, ab: ab.length, barsOk, barsN, nameOk, nameN, chordOk, chordN };
}

const files = existsSync(folder) ? readdirSync(folder).filter((f) => /\.(mp3|wav|m4a|mp4|aac)$/i.test(f)).sort() : [];
if (!files.length) {
  console.log(`音源が見つかりません：${folder}`);
  process.exit(1);
}
const sum = { hitT: 0, tb: 0, hitA: 0, ab: 0, barsOk: 0, barsN: 0, nameOk: 0, nameN: 0, chordOk: 0, chordN: 0 };
for (const f of files) {
  const name = basename(f, extname(f));
  // 正解ファイルは音源と同じ名前。「パープルヘイズ.m4a」と「パープル・ヘイズ.txt」のような、中黒・空白・濁点の表し方の違いは同じとみなす
  const key = (n: string) => n.normalize('NFC').replace(/[・･\s]/g, '');
  const truthName = readdirSync(folder).find((x) => extname(x) === '.txt' && key(basename(x, '.txt')) === key(name));
  const truthFile = join(folder, truthName ?? `${name}.txt`);
  const truth = existsSync(truthFile) ? parseTruth(readFileSync(truthFile, 'utf8')) : null;
  const y = decode(join(folder, f));
  let song = songFromAnalysis(analyze(y, ANALYSIS_SR, undefined, tuning));
  const raw = song.bpmEst;
  // 画面と同じく、参考の BPM（ここでは正解の BPM）から倍・半分を判定して作り直す
  const f2 = truth?.bpm && raw ? octaveByReference(raw, truth.bpm) : null;
  if (f2 === 2 || f2 === 0.5) song = songFromAnalysis(analyze(y, ANALYSIS_SR, undefined, { ...tuning, bpm: Math.round(raw! * f2 * 10) / 10 }));
  const parts = song.sections;
  console.log(`\n■ ${name}`);
  console.log(`  推定 BPM ${raw}${f2 === 2 || f2 === 0.5 ? ` → 参考の BPM で ${song.bpmEst} に修正` : ''} / 区間 ${parts.length} / 最長 ${Math.max(...parts.map((s) => s.barsEst ?? 0))}小節`);
  if (!truth || !truth.sections.length) {
    console.log('  正解ファイルがない（または区間が書かれていない）ため、判定はしません');
    continue;
  }
  // 構成表は曲の頭を 0:00 にしている。「テキストで保存」の正解ファイルも同じ時刻なので、そのまま比べる。
  // 曲頭が「無音」の行で始まる正解ファイル（無音を区間にしていたころの形式）は音源ファイルの時刻なので、自動の側を音源ファイルの時刻に戻す。
  // 正解の「無音」の行は区切りとして数えない（自動の側も曲頭・曲末の無音を区切りにしないため）
  const fileTime = truth.sections[0]?.name === '無音';
  const r = evaluate(fileTime ? shiftSong(song, song.audio?.offset ?? 0) : song, { ...truth, sections: truth.sections.filter((s) => s.name !== '無音') });
  for (const l of r.lines) console.log(`  ${l}`);
  for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r[k];
}
if (sum.tb || sum.nameN || sum.barsN) {
  console.log('\n■ 全体');
  console.log(`  区切り：正解のうち当たり ${pct(sum.hitT, sum.tb)}・自動のうち当たり ${pct(sum.hitA, sum.ab)}`);
  console.log(`  小節数：一致 ${pct(sum.barsOk, sum.barsN)}`);
  console.log(`  名前の候補：一致 ${pct(sum.nameOk, sum.nameN)}`);
  if (sum.chordN) console.log(`  コード：一致 ${pct(sum.chordOk, sum.chordN)}`);
}
