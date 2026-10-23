// 曲メモの構成データと編集ルール（要件定義書 5.2）。画面と API の両方で使う。

export type Section = {
  id: string;
  start: number; // 秒
  end: number; // 秒
  name: string;
  nameAuto: boolean; // 繰り返しの記号から自動で付いた名前か
  group: string | null; // 繰り返し（同じ内容の区間に付ける記号 A, B, …。画面では「繰り返しA」）
  groupManual: boolean; // 利用者が繰り返しを付け替えたか
  barsEst: number | null; // 推定小節数（テンポ・拍子から計算）
  barsManual: number | null; // 手動指定の小節数
  barsNeedsCheck: boolean; // 結合で手動小節数が外れ、確認が必要
  memo: string;
  edited: boolean; // 手動修正済み
  silence?: boolean; // 曲頭・曲末の無音（以前の形式）。今は作らず、読み込むときに trimSilence で取り除く
  energy?: number; // 解析で測った音量（dB）。名前の候補の推定に使う
  vocal?: number; // 解析で測った歌の割合（0〜1。歌の音の大きさ ÷ 全体）。名前の候補の推定に使う
  // 手で入れたコード進行（1行。小節の区切りは |）。null なら繰り返しの1回目に入れたもの、なければ推定を使う。原曲のキーで書く
  chords?: string | null;
  // 原曲との違い（カバーで演奏するときの変更）。cut：この区間は演奏しない。arrange：違う点の短いメモ（例：2回繰り返す）
  cut?: boolean;
  arrange?: string | null;
  // 分割でできた2区間の対応。片方の小節数を入れると、もう片方を「元の小節数 − 入れた値」にする
  split?: { partner: string; total: number; start: number; end: number } | null;
};

export type Song = {
  title: string;
  artist: string;
  memo: string;
  duration: number; // 秒
  bpmEst: number | null;
  bpmManual: number | null;
  beatsPerBar: number;
  firstDownbeat: number | null; // 最初の小節頭（秒）
  firstDownbeatManual: boolean;
  beats: number[] | null; // 推定した拍位置（秒）
  beatsUncertain: boolean; // 拍・小節が確定できない
  analysisVersion: string | null;
  sections: Section[];
  // 最後に採用した自動解析の結果。手動修正をやめて「自動解析の結果に戻す」ときに使う
  analysis?: AnalysisSnapshot | null;
  // 繰り返しの記号ごとの名前（例：B → サビ）。同じ繰り返しの、名前を付けていない区間に使う
  groupNames?: Record<string, string>;
  // 再生に使う YouTube の動画 ID。音は取り出せないため、自動解析には使わない
  youtube?: string | null;
  // 構成表の時刻と YouTube の動画の時刻のずれ（秒）。動画の時刻 = 構成表の時刻 + ずれ。
  // 音源と動画で曲頭の無音や MV の前置きの長さが違うときに合わせる。構成表の時刻は変えない
  youtubeOffset?: number;
  // 構成を作った音源ファイル。offset：ファイルの何秒目が曲の頭（0:00）か（曲頭の無音の長さ）。duration：ファイルの長さ。
  // 構成表の時刻は曲の頭からの時刻で、音源ファイルで再生するときだけ offset を足す
  audio?: { offset: number; duration: number } | null;
  // 推定したコードの変わり目（曲の頭からの秒）。N は和音なし。区間ごとのコード進行はここから小節に合わせて作る
  chords?: ChordChange[] | null;
  // コード譜のページ（U-FRET など）。編集する人が選び、閲覧ページにリンクとして出す。内容は取り込まない
  chordChartUrl?: string | null;
  // 原曲のキー（例：Eb、Cm）と、演奏するキーへの移調（半音、-11〜11）。コード進行は原曲のキーで持ち、表示するときに移調する
  originalKey?: string | null;
  transpose?: number;
};

export type ChordChange = { t: number; chord: string };

// 区間の名前の候補（入力欄で選べる）
export const SECTION_NAMES = ['イントロ前', 'イントロ', 'Aメロ', 'Bメロ', 'Cメロ', 'サビ', '大サビ', '落ちサビ', '間奏', 'ソロ', 'ブレイク', 'アウトロ'];

export type AnalysisSnapshot = {
  duration: number;
  bpm: number | null;
  firstDownbeat: number | null;
  beatsUncertain: boolean;
  segments: { start: number; end: number; group: string; energy?: number; vocal?: number }[];
  leadingSilence?: number; // 曲頭の無音（秒）
  trailingSilence?: number; // 曲末の無音（秒）
};

export const MIN_SECTION = 0.5; // 区間の最短長（秒）
export const LIMITS = { sections: 300, beats: 4000, chords: 4000, chordText: 500, url: 500, text: 200, memo: 2000, duration: 3600 };

export const newId = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const bpmOf = (s: Song) => s.bpmManual ?? s.bpmEst;

// 時刻 t を含む区間。なければ undefined
export const sectionAt = (s: Song, t: number) => s.sections.find((x) => t >= x.start && t < x.end);

// YouTube の URL（watch・youtu.be・shorts・embed・music.youtube.com）か動画 ID から、動画 ID を取り出す。読めなければ null
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
export function youtubeId(text: string): string | null {
  const t = text.trim();
  if (YOUTUBE_ID.test(t)) return t;
  let u: URL;
  try { u = new URL(/^https?:\/\//.test(t) ? t : `https://${t}`); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.split('/')[1] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, rest] = u.pathname.split('/');
    id = kind === 'watch' ? u.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(kind) ? rest ?? null : null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}
export const youtubeUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const MAX_YOUTUBE_OFFSET = 600;
const round3 = (t: number) => Math.round(t * 1000) / 1000;

// 曲の時刻をまとめて dt 秒ずらす（区間・拍・最初の小節頭・分割の記録）
export function shiftSong(song: Song, dt: number): Song {
  if (!dt) return song;
  const sh = (t: number) => round3(t + dt);
  return {
    ...song,
    duration: sh(song.duration),
    beats: song.beats?.map(sh) ?? null,
    firstDownbeat: song.firstDownbeat == null ? null : sh(song.firstDownbeat),
    chords: song.chords?.map((c) => ({ ...c, t: sh(c.t) })) ?? song.chords,
    sections: song.sections.map((x) => ({ ...x, start: sh(x.start), end: sh(x.end), split: x.split ? { ...x.split, start: sh(x.split.start), end: sh(x.split.end) } : x.split })),
  };
}

// 以前の形式（曲頭・曲末の「無音」の区間）を、曲の頭を 0:00 とする形に直す。
// 曲頭の無音の長さは音源ファイルのずれ（audio.offset）にし、YouTube のずれも同じだけ足して再生位置を保つ。
// 無音の区間に書いたメモは全体メモへ移す。無音の区間がなければそのまま返す
export function trimSilence(song: Song): Song {
  const secs = song.sections;
  if (!secs.some((x) => x.silence)) return song;
  let a = 0, b = secs.length;
  while (a < b && secs[a].silence) a++;
  while (b > a && secs[b - 1].silence) b--;
  if (a === b) return { ...song, sections: secs.map((x) => ({ ...x, silence: false })) };
  const lead = secs[a].start;
  const notes = secs.filter((x, i) => x.silence && (i < a || i >= b) && x.memo.trim()).map((x) => `${x.name}：${x.memo.trim()}`);
  const kept = secs.slice(a, b).map((x) => (x.silence ? { ...x, silence: false } : x));
  const trimmed: Song = {
    ...song,
    duration: kept[kept.length - 1].end,
    sections: kept,
    memo: [song.memo.trim(), ...notes].filter(Boolean).join('\n').slice(0, LIMITS.memo),
    audio: { offset: round3((song.audio?.offset ?? 0) + lead), duration: song.audio?.duration ?? song.duration },
    youtubeOffset: song.youtube && lead ? clampOffset((song.youtubeOffset ?? 0) + lead) || undefined : song.youtubeOffset,
  };
  return normalize(shiftSong(trimmed, -lead));
}
// ずれは 0.01 秒単位にそろえ、範囲に収める
export const clampOffset = (x: number) => Math.round(Math.max(-MAX_YOUTUBE_OFFSET, Math.min(MAX_YOUTUBE_OFFSET, x)) * 100) / 100;
// 拍・小節が使えるか。解析で確定できなくても、BPM を手動で入れれば使える
export const hasGrid = (s: Song) => bpmOf(s) != null && (s.bpmManual != null || !s.beatsUncertain);
// 解析で見つけた拍の位置を小節の線に使えるか。BPM を推定と大きく違う値に手で直した場合は使わない（拍の列が合わないため）
export const usesDetectedBeats = (s: Song) =>
  !!s.beats && s.beats.length >= 8 && !s.beatsUncertain &&
  (s.bpmManual == null || (s.bpmEst != null && Math.abs(s.bpmManual / s.bpmEst - 1) <= 0.03));

// 拍の位置の列（秒）。解析で見つけた拍が使えればそれを使い、テンポの揺れに追従する。
// 使えなければ BPM と最初の小節頭から等間隔に作る。曲の前後は端の間隔で延長する
function beatGrid(s: Song): number[] | null {
  const end = Math.max(s.duration, s.sections[s.sections.length - 1]?.end ?? 0);
  let beats: number[];
  if (usesDetectedBeats(s)) {
    beats = s.beats!.slice();
  } else {
    const bpm = bpmOf(s);
    if (!bpm || !hasGrid(s)) return null;
    const beat = 60 / bpm;
    const origin = s.firstDownbeat ?? 0;
    const k0 = Math.floor(-origin / beat) - 1;
    const k1 = Math.ceil((end - origin) / beat) + 1;
    return Array.from({ length: k1 - k0 + 1 }, (_, i) => origin + (k0 + i) * beat);
  }
  const head = beats[1] - beats[0];
  while (beats[0] > 0) beats.unshift(beats[0] - head);
  const tail = beats[beats.length - 1] - beats[beats.length - 2];
  while (beats[beats.length - 1] < end) beats.push(beats[beats.length - 1] + tail);
  return beats;
}

// 小節数を手で推定と違う数に直した区間。曲の途中でテンポが変わる曲（夏の日の午後のイントロなど）では、
// 曲のテンポで数えた小節数が合わないので、その区間の中は手で入れた小節数で等分した拍にする
const manualTempoSections = (s: Song) =>
  s.sections.filter((x) => !x.silence && x.barsManual != null && x.barsManual > 0 && x.barsEst != null && x.barsManual !== x.barsEst);

// 区間のテンポ。小節数を手で推定と違う数に直した区間だけ、手の小節数から求める（それ以外は曲の BPM なので null）
export function sectionBpm(s: Song, sec: Section): number | null {
  if (!manualTempoSections(s).some((x) => x.id === sec.id) || sec.end <= sec.start) return null;
  return Math.round(((sec.barsManual! * Math.max(1, s.beatsPerBar) * 60) / (sec.end - sec.start)) * 10) / 10;
}

// 拍の位置の列と、それぞれが小節の頭か。最初の小節頭に最も近い拍から、拍子の数ごとに小節の頭にする。
// 小節数を手で直した区間の中は、その小節数で等分した拍に置き換える
function beatsWithBars(s: Song): { t: number; head: boolean }[] | null {
  const beats = beatGrid(s);
  if (!beats || beats.length < 2) return null;
  const origin = s.firstDownbeat ?? beats[0];
  let phase = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - origin) < Math.abs(beats[phase] - origin)) phase = i;
  const n = Math.max(1, s.beatsPerBar);
  const out = beats.map((t, i) => ({ t, head: (((i - phase) % n) + n) % n === 0 }));
  const manual = manualTempoSections(s);
  if (!manual.length) return out;
  const inside = (t: number) => manual.some((x) => t >= x.start - 0.05 && t < x.end - 0.05);
  const res = out.filter((b) => !inside(b.t));
  for (const x of manual) {
    const k = x.barsManual! * n;
    for (let i = 0; i < k; i++) res.push({ t: x.start + ((x.end - x.start) * i) / k, head: i % n === 0 });
  }
  return res.sort((a, b) => a.t - b.t);
}

// 拍の位置の列（秒）。小節数を手で直した区間の中は、その小節数で等分した拍
const beatTimes = (s: Song) => beatsWithBars(s)?.map((b) => b.t) ?? null;

// 小節の頭の位置の列（秒）
export function barLines(s: Song): number[] | null {
  const lines = beatsWithBars(s)?.filter((b) => b.head).map((b) => b.t) ?? [];
  return lines.length >= 2 ? lines : null;
}

// メトロノームを曲の拍に合わせて鳴らす位置（曲の頭からの秒）。0 秒より前の拍は除く
export const beatClicks = (s: Song) => beatsWithBars(s)?.filter((b) => b.t >= 0) ?? null;

// 位置 t が何小節目にあたるか（小数）。線の間は直線で補い、前後は端の間隔で延長する
function indexAt(lines: number[], t: number): number {
  const last = lines.length - 1;
  if (t <= lines[0]) return (t - lines[0]) / (lines[1] - lines[0]);
  if (t >= lines[last]) return last + (t - lines[last]) / (lines[last] - lines[last - 1]);
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lines[mid] <= t) lo = mid; else hi = mid;
  }
  return lo + (t - lines[lo]) / (lines[hi] - lines[lo]);
}

// 最初の区間の始まりから、その後の最初の小節頭までの拍の数（小数）。イントロ前の1拍・1.5拍など（弱起）。
// 半拍単位に丸めて 0 か1小節分になるとき（曲の頭が小節頭とほぼ同じ）は 0
function leadBeats(song: Song, beats: number[]): number {
  const first = song.sections[0];
  if (!first || first.silence || song.firstDownbeat == null) return 0;
  const n = Math.max(1, song.beatsPerBar);
  const d = (((indexAt(beats, song.firstDownbeat) - indexAt(beats, first.start)) % n) + n) % n;
  const half = Math.round(d * 2) / 2;
  return half > 0 && half < n ? d : 0;
}

// 区間 sec が最初の区間で、最初の小節頭より前に拍があれば、その拍の数（半拍単位）。なければ null。
// 小節数を手で直してその小節数で等分している区間は、小節頭を区間の始まりに置くので null
export function pickupBeats(song: Song, sec: Section): number | null {
  if (song.sections[0]?.id !== sec.id || sectionBpm(song, sec) != null) return null;
  const beats = beatGrid(song);
  const d = beats && beats.length >= 2 ? leadBeats(song, beats) : 0;
  return d ? Math.round(d * 2) / 2 : null;
}

// 前の拍を手で直せるか。拍と最初の小節頭が決まっていて、最初の区間を手の小節数で等分していないとき
export function canSetPickup(song: Song): boolean {
  const first = song.sections[0], beats = beatGrid(song);
  return !!first && !first.silence && song.firstDownbeat != null && !!beats && beats.length >= 2 && sectionBpm(song, first) == null;
}

// 拍の番号 k（小数）の時刻。拍の間は直線で補い、前後は端の間隔で延長する
function timeAtIndex(lines: number[], k: number): number {
  const i = Math.floor(k), a = timeAt(lines, i);
  return a + (timeAt(lines, i + 1) - a) * (k - i);
}

// 最初の小節頭より前の拍を n 拍（半拍単位）にする。最初の小節頭と小節の線は音源の上で動かさず、曲の頭を
// 「曲の頭のあとの最初の小節頭の n 拍前」に置き直す。音源ファイル・YouTube のずれも同じだけ動かして、再生位置を保つ。
// 拍ちょうどに置くと、少し前に突っ込んだ最初の音の出だしが切れるので、0.05秒（最大0.2拍）前に置く（解析の曲の頭と同じ余裕）。
// 曲の頭を音源ファイルの頭より前にする・最初の区間が短くなりすぎるときは、何もしない
export function setPickup(song: Song, n: number): Song {
  const first = song.sections[0], beats = beatGrid(song);
  if (!canSetPickup(song) || !beats) return song;
  const per = Math.max(1, song.beatsPerBar);
  const want = Math.max(0, Math.min(per - 0.5, Math.round(n * 2) / 2));
  const head = indexAt(beats, first.start);
  const d = (((indexAt(beats, song.firstDownbeat!) - head) % per) + per) % per;
  const bar = head + (d > per - 0.25 ? d - per : d); // 曲の頭の直前（0.25拍以内）の小節頭は、曲の頭の小節頭とみなす
  const margin = Math.min(0.05, 0.2 * (timeAtIndex(beats, bar) - timeAtIndex(beats, bar - 1)));
  const at = round3(timeAtIndex(beats, bar - want) - margin);
  const dt = round3(at - first.start);
  if (!dt || at >= first.end - MIN_SECTION || (song.audio && song.audio.offset + dt < 0)) return song;
  const moved: Song = {
    ...song,
    sections: [{ ...first, start: at, edited: true }, ...song.sections.slice(1)],
    audio: song.audio ? { ...song.audio, offset: round3(song.audio.offset + dt) } : song.audio,
    youtubeOffset: song.youtube ? clampOffset((song.youtubeOffset ?? 0) + dt) || undefined : song.youtubeOffset,
  };
  return normalize(shiftSong(moved, -at));
}

function timeAt(lines: number[], k: number): number {
  const last = lines.length - 1;
  if (k < 0) return lines[0] + k * (lines[1] - lines[0]);
  if (k > last) return lines[last] + (k - last) * (lines[last] - lines[last - 1]);
  return lines[k];
}

// 1小節の平均の長さ（秒）。表示や、音源なしで区間を足すときの目安に使う
export const barSeconds = (s: Song) => {
  const lines = barLines(s);
  return lines ? (lines[lines.length - 1] - lines[0]) / (lines.length - 1) : null;
};

export function emptySong(duration = 0): Song {
  return {
    title: '', artist: '', memo: '', duration,
    bpmEst: null, bpmManual: null, beatsPerBar: 4,
    firstDownbeat: null, firstDownbeatManual: false,
    beats: null, beatsUncertain: false, analysisVersion: null,
    sections: [],
  };
}

export function newSection(start: number, end: number, init: Partial<Section> = {}): Section {
  return {
    id: newId(), start, end, name: '', nameAuto: true, group: null, groupManual: false,
    barsEst: null, barsManual: null, barsNeedsCheck: false, memo: '', edited: false, ...init,
  };
}

// 曲全体を1つの区間にする（手動で作り始めたとき・自動生成に失敗したとき）。音源ファイルの長さなら、構成を作った音源として残す
export function wholeSong(song: Song, duration: number, fromFile = false): Song {
  return normalize({ ...song, duration, sections: [newSection(0, duration)], ...(fromFile ? { audio: { offset: 0, duration } } : {}) });
}

// 推定小節数を再計算し、自動の名前を付け直す
export function normalize(song: Song): Song {
  // 小節数は区間ごとに、その区間の始まりから拍を数えて求める（拍の数 ÷ 拍子）。
  // 曲の頭から通しで数えると、最初の小節頭のずれや途中の2拍だけの小節が、後ろの区間すべてに持ち越されるため。
  // 最初の区間は、最初の小節頭より前の拍（弱起）を除いて数える（画面では「＋1.5拍」のように別に示す）
  const beats = beatGrid(song);
  const perBar = Math.max(1, song.beatsPerBar);
  const lead = beats && beats.length >= 2 ? leadBeats(song, beats) : 0;
  const total = new Map<string, number>();
  for (const s of song.sections) if (s.group) total.set(s.group, (total.get(s.group) ?? 0) + 1);
  const seen = new Map<string, number>();
  const sections = song.sections.map((s, i) => {
    const count = beats && !s.silence ? indexAt(beats, s.end) - indexAt(beats, s.start) - (i === 0 ? lead : 0) : null;
    const barsEst = count != null ? Math.max(0, Math.round(count / perBar)) : null;
    let name = s.name;
    if (s.nameAuto && !s.silence) {
      // 例：パートA（1回目）・パートA（2回目）。1回しか出てこなければ「パートA」
      const n = s.group ? (seen.get(s.group) ?? 0) + 1 : 0;
      const base = s.group ? song.groupNames?.[s.group] || `パート${s.group}` : 'パート';
      name = s.group && (total.get(s.group) ?? 0) > 1 ? `${base}（${n}回目）` : base;
    }
    if (s.group) seen.set(s.group, (seen.get(s.group) ?? 0) + 1);
    return { ...s, barsEst, name };
  });
  return { ...song, sections };
}

const update = (song: Song, sections: Section[]) => normalize({ ...song, sections });
const indexOf = (song: Song, id: string) => {
  const i = song.sections.findIndex((s) => s.id === id);
  if (i < 0) throw new Error('区間が見つかりません');
  return i;
};

// 区間 i の開始位置（= 区間 i-1 の終了位置）を動かす。前後の境界の内側に制限する
export function moveBoundary(song: Song, i: number, t: number): Song {
  const secs = song.sections;
  if (i <= 0 || i >= secs.length) return song;
  const lo = secs[i - 1].start + MIN_SECTION;
  const hi = secs[i].end - MIN_SECTION;
  if (lo > hi) return song;
  const at = Math.min(hi, Math.max(lo, t));
  const next = secs.slice();
  next[i - 1] = { ...secs[i - 1], end: at, edited: true };
  next[i] = { ...secs[i], start: at, edited: true };
  return update(song, next);
}

// 位置 t で区間を2つに分ける。後半は繰り返し・メモを持たない新しい区間になる。
// 名前は前半と同じにする（手で付けた名前か、繰り返しに付けた名前があるとき。「パートB」のような仮の名前は引き継がない）
export function splitAt(song: Song, t: number): Song {
  const i = song.sections.findIndex((s) => t > s.start + MIN_SECTION && t < s.end - MIN_SECTION);
  if (i < 0) return song;
  const cur = song.sections[i];
  const total = cur.barsManual ?? cur.barsEst;
  const name = !cur.nameAuto ? cur.name.trim() : cur.group ? song.groupNames?.[cur.group] ?? '' : '';
  const second = newSection(t, cur.end, { edited: true, energy: cur.energy, vocal: cur.vocal, ...(name ? { name, nameAuto: false } : {}) });
  const pair = (partner: string) => (total != null ? { partner, total, start: cur.start, end: cur.end } : null);
  second.split = pair(cur.id);
  // 小節数を手で推定と違う数に直した区間（区間のテンポが曲と違う）は、手の小節数を分けて、それぞれのテンポを保つ
  let firstBars: number | null = null;
  if (manualTempoSections(song).some((x) => x.id === cur.id)) {
    firstBars = Math.round((cur.barsManual! * (t - cur.start)) / (cur.end - cur.start));
    if (firstBars > 0 && firstBars < cur.barsManual!) second.barsManual = cur.barsManual! - firstBars;
    else firstBars = null;
  }
  const next = song.sections.slice();
  next.splice(i, 1, { ...cur, end: t, barsManual: firstBars, edited: true, split: pair(second.id) }, second);
  return update(song, next);
}

// 分割の相手がまだ有効か（隣り合っていて、2区間を合わせた範囲が分割前と同じ）
function splitPartner(sections: Section[], s: Section): Section | null {
  if (!s.split) return null;
  const p = sections.find((x) => x.id === s.split!.partner);
  if (!p || p.split?.partner !== s.id) return null;
  const eps = 1e-6;
  const adjacent = Math.abs(p.end - s.start) < eps || Math.abs(s.end - p.start) < eps;
  const sameRange = Math.abs(Math.min(s.start, p.start) - s.split.start) < eps && Math.abs(Math.max(s.end, p.end) - s.split.end) < eps;
  return adjacent && sameRange ? p : null;
}

// keep 側の名前・繰り返し・メモを残して、隣り合う2区間を1つにする
function combine(song: Song, keep: number, drop: number): Song {
  const a = song.sections[keep], b = song.sections[drop];
  const bothManual = a.barsManual != null && b.barsManual != null;
  const merged: Section = {
    ...a,
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    barsManual: bothManual ? a.barsManual! + b.barsManual! : null,
    barsNeedsCheck: !bothManual && (a.barsManual != null || b.barsManual != null) ? true : a.barsNeedsCheck,
    edited: true,
    split: null,
    energy: a.energy != null && b.energy != null
      ? Math.round(((a.energy * (a.end - a.start) + b.energy * (b.end - b.start)) / (Math.max(a.end, b.end) - Math.min(a.start, b.start))) * 10) / 10
      : a.energy ?? b.energy,
    vocal: a.vocal != null && b.vocal != null
      ? Math.round(((a.vocal * (a.end - a.start) + b.vocal * (b.end - b.start)) / (Math.max(a.end, b.end) - Math.min(a.start, b.start))) * 1000) / 1000
      : a.vocal ?? b.vocal,
  };
  const next = song.sections.slice();
  next.splice(Math.min(keep, drop), 2, merged);
  return update(song, next);
}

// 区間を削除する。直前の区間と結合し、先頭区間のときだけ直後の区間と結合する
export function deleteSection(song: Song, id: string): Song {
  if (song.sections.length <= 1) return song;
  const i = indexOf(song, id);
  return i > 0 ? combine(song, i - 1, i) : combine(song, 1, 0);
}

// 区間を次の区間と結合する（境界を取り除く）。名前などはこの区間のものを残す
export function mergeWithNext(song: Song, id: string): Song {
  const i = indexOf(song, id);
  if (i >= song.sections.length - 1) return song;
  return combine(song, i, i + 1);
}

// 末尾に区間を追加する（音源なしの手動作成用）。曲の長さも延ばす
export function appendSection(song: Song, seconds?: number): Song {
  const len = seconds ?? barSeconds(song) ?? 2;
  const start = song.duration;
  const end = start + Math.max(MIN_SECTION, len * (seconds ? 1 : 8));
  return update({ ...song, duration: end }, [...song.sections, newSection(start, end, { edited: true })]);
}

export function patchSection(song: Song, id: string, patch: Partial<Pick<Section, 'name' | 'memo' | 'barsManual' | 'chords' | 'cut' | 'arrange'>>): Song {
  const i = indexOf(song, id);
  const next = song.sections.slice();
  const s = { ...next[i], ...patch, edited: true };
  let groupNames = song.groupNames;
  if ('name' in patch) {
    s.nameAuto = false;
    // 繰り返しの1回目に名前を付けたら、同じ繰り返しの名前未設定の区間にも使う（例：サビ → サビ（2回目））
    if (s.group && next.findIndex((x) => x.group === s.group) === i) {
      groupNames = { ...groupNames };
      const name = (patch.name ?? '').trim();
      if (name) groupNames[s.group] = name;
      else delete groupNames[s.group];
    }
  }
  if ('barsManual' in patch) s.barsNeedsCheck = false;
  next[i] = s;
  // 分割した片方の小節数を入れたら、もう片方を残りの小節数にする
  const p = 'barsManual' in patch && s.barsManual != null ? splitPartner(next, s) : null;
  if (p && s.barsManual! <= s.split!.total) {
    next[next.indexOf(p)] = { ...p, barsManual: s.split!.total - s.barsManual!, barsNeedsCheck: false, edited: true };
  }
  return update({ ...song, groupNames }, next);
}

export const groupsOf = (song: Song) =>
  [...new Set(song.sections.map((s) => s.group).filter((g): g is string => !!g))].sort();

export function nextGroupName(song: Song) {
  const used = new Set(groupsOf(song));
  for (let i = 0; ; i++) {
    const name = i < 26 ? String.fromCharCode(65 + i) : `Z${i - 25}`;
    if (!used.has(name)) return name;
  }
}

// 繰り返しを付け替える。group は既存の記号、'new'（新しい繰り返し）、null（繰り返しなし）
export function setGroup(song: Song, id: string, group: string | 'new' | null): Song {
  const i = indexOf(song, id);
  const g = group === 'new' ? nextGroupName(song) : group;
  const next = song.sections.slice();
  next[i] = { ...next[i], group: g, groupManual: true, edited: true };
  return update(song, next);
}

export function setTempo(song: Song, patch: Partial<Pick<Song, 'bpmManual' | 'beatsPerBar' | 'firstDownbeat'>>): Song {
  const s = { ...song, ...patch };
  if ('firstDownbeat' in patch) s.firstDownbeatManual = patch.firstDownbeat != null;
  // 最初の小節頭だけを直したときは、小節の線に乗っていた区切りも小節の線と一緒に動かす
  // （解析が小節頭を2拍取り違えると、区切りもすべて2拍ずれているため）
  if (Object.keys(patch).length === 1 && patch.firstDownbeat != null && song.firstDownbeat != null) {
    s.sections = followBarLines(song, patch.firstDownbeat);
  }
  return normalize(s);
}

// 最初の小節頭を to に動かしたとき、小節の線に乗っていた区切り（0.25拍以内）を、線と同じ拍数だけ動かした区切りの列。
// 動かす拍数は1小節未満にし、向きは最初の小節頭を動かした向きにそろえる（半小節ずらしたときに、どちらへ動かすかを決めるため）。
// 最初の区間の始まり（曲の頭）は動かさない。動かすと区間が短くなりすぎる区切りはそのまま
function followBarLines(song: Song, to: number): Section[] {
  const beats = beatGrid(song), secs = song.sections;
  if (!beats || beats.length < 2 || song.firstDownbeat == null || manualTempoSections(song).length) return secs;
  const per = Math.max(1, song.beatsPerBar);
  const from = indexAt(beats, song.firstDownbeat);
  let move = indexAt(beats, to) - from;
  if (usesDetectedBeats(song)) move = Math.round(move); // 解析で見つけた拍を使うときは、小節頭はいちばん近い拍になる
  move = Math.sign(move) * (Math.abs(move) % per);
  if (Math.abs(move) < 0.25 || per - Math.abs(move) < 0.25) return secs;
  const onBar = (t: number) => {
    const d = (((indexAt(beats, t) - from) % per) + per) % per;
    return d < 0.25 || per - d < 0.25;
  };
  const next = secs.map((x) => ({ ...x }));
  for (let i = 1; i < next.length; i++) {
    if (!onBar(secs[i].start)) continue;
    const at = round3(timeAtIndex(beats, indexAt(beats, secs[i].start) + move));
    if (at - next[i - 1].start < MIN_SECTION || next[i].end - at < MIN_SECTION) continue;
    next[i - 1].end = at;
    next[i] = { ...next[i], start: at, edited: true };
  }
  return next;
}

// 区間名の候補（イントロ前・イントロ・Aメロ・Bメロ・サビ・間奏・アウトロ）を推定する。確定ではなく候補として示す。
// 手がかりは、繰り返し（同じ記号）、並び、音量、歌の割合（解析で推定できたとき）。
// 歌の割合がないとき（以前の解析・推定できなかったとき）は、ソロと歌のパートを区別しない。
// 戻り値：区間ID → 候補名（無音・候補なしの区間は含まない）
export function suggestNames(song: Song): Record<string, string> {
  const secs = song.sections.filter((s) => !s.silence);
  const out: Record<string, string> = {};
  if (secs.length < 3) return out;
  const groups = new Map<string, { idx: number[]; energy: number[] }>();
  secs.forEach((s, i) => {
    if (!s.group) return;
    const g = groups.get(s.group) ?? { idx: [], energy: [] };
    g.idx.push(i);
    if (s.energy != null) g.energy.push(s.energy);
    groups.set(s.group, g);
  });
  const avg = (xs: number[]) => (xs.length ? xs.reduce((p, x) => p + x, 0) / xs.length : NaN);
  // 歌のある区間：歌の割合が、曲の中の上位4分の1の区間の値（その曲の歌の大きさの目安）の 0.3 倍以上。
  // 歌の割合の大きさは曲によって違う（0.08〜0.5）ので、曲の中で比べる。全区間に歌の割合があるときだけ使う
  const vocals = secs.map((s) => s.vocal);
  const ref = vocals.every((v) => v != null) ? vocals.map((v) => v!).sort((a, b) => a - b)[Math.floor(secs.length * 0.75)] : 0;
  const sing = (i: number) => !ref || secs[i].vocal! >= ref * 0.3;
  // サビ・Aメロ・Bメロを決めるときは、繰り返しのうち歌のある回だけを見る（イントロや間奏でサビの伴奏だけが鳴る回を除く）
  const sung = new Map([...groups].map(([k, g]) => {
    const idx = g.idx.filter(sing);
    return [k, { idx, energy: idx.map((i) => secs[i].energy).filter((e): e is number => e != null) }];
  }));
  const repeated = [...sung.entries()].filter(([, g]) => g.idx.length >= 2);
  if (!repeated.length) return out;
  const all = secs.map((s) => s.energy).filter((e): e is number => e != null);
  const mean = avg(all), sd = Math.sqrt(avg(all.map((e) => (e - mean) ** 2))) || 1;
  const bars = (i: number) => secs[i].barsManual ?? secs[i].barsEst ?? 0;
  // サビ：繰り返すパートのうち、長く・音量が大きく・回数が多いもの。曲の頭から鳴るパート（イントロのリフなど）は下げる。
  // 音量差の小さい曲（音圧をそろえたロックなど）が多いので、音量より長さを重く見る
  const chorusScore = ([, g]: [string, { idx: number[]; energy: number[] }]) => {
    const e = g.energy.length ? (avg(g.energy) - mean) / sd : 0;
    const len = avg(g.idx.map(bars));
    return 0.7 * e + 0.3 * g.idx.length + 0.6 * (len / 8) - (g.idx[0] <= 1 ? 0.8 : 0);
  };
  const [chorus, cg] = repeated.slice().sort((a, b) => chorusScore(b) - chorusScore(a))[0];
  const lastChorus = cg.idx[cg.idx.length - 1];
  const name = (i: number, n: string) => { out[secs[i].id] = n; };
  // イントロ前：曲の頭の、2小節以下の短いパート（ドラムのフィルなど）か、ほかより音が小さい（平均より標準偏差1つ分以上）パート。
  // 音が小さいだけのときは、次のパートが繰り返さない場合に限る（次が Aメロなら、音の小さいパートはイントロそのもの）
  const once = (i: number) => (groups.get(secs[i].group ?? '')?.idx.length ?? 1) < 2;
  const quiet = (i: number) => secs[i].energy != null && (secs[i].energy! - mean) / sd < -1;
  let head = 0;
  while (head < secs.length - 2 && secs[head].group !== chorus && (bars(head) <= 2 || (quiet(head) && once(head + 1)))) head++;
  // イントロ前の次のパートは、サビでなければイントロとみなす（Aメロから始まる曲より、イントロから始まる曲のほうがずっと多い）。
  // イントロ前・イントロの素材は間奏・アウトロでもう一度出てくることが多いので、繰り返していても Aメロ・Bメロの候補にしない
  const introGroups = new Set(secs.slice(0, head + 1).map((s) => s.group).filter((g): g is string => !!g && g !== chorus));
  for (const g of introGroups) for (const i of groups.get(g)!.idx) name(i, i < head ? 'イントロ前' : i === head ? 'イントロ' : i > lastChorus ? 'アウトロ' : '間奏');
  const melodies = repeated.filter(([g]) => !introGroups.has(g));
  // イントロ：最初に（イントロ以外の）繰り返しが始まる前。アウトロ：最後のサビの後の、繰り返さないパート
  const firstRepeat = melodies.length ? Math.min(...melodies.map(([, g]) => g.idx[0])) : 0;
  for (let i = 0; i < firstRepeat; i++) name(i, i < head ? 'イントロ前' : 'イントロ');
  for (let i = lastChorus + 1; i < secs.length; i++) if (once(i)) name(i, 'アウトロ');
  for (const i of cg.idx) name(i, 'サビ');
  // サビの続き：いつもサビの直後にだけ出てくる、サビより短い繰り返しのパートは、サビの一部とみなす
  // （サビが 12小節＋4小節 のように分かれる場合。夏の日の午後）
  const chorusLen = avg(cg.idx.map(bars));
  const tails = new Set(melodies.filter(([g, x]) => g !== chorus && x.idx.every((i) => i > 0 && secs[i - 1].group === chorus) && avg(x.idx.map(bars)) < chorusLen).map(([g]) => g));
  for (const g of tails) for (const i of sung.get(g)!.idx) name(i, 'サビ');
  // Aメロ：イントロの後、最初に出てくる繰り返しのパート。Bメロ：Aメロとサビの間によく出てくる繰り返しのパート
  const others = melodies.filter(([g]) => g !== chorus && !tails.has(g)).sort((a, b) => a[1].idx[0] - b[1].idx[0]);
  const verse = others.find(([, g]) => g.idx[0] < cg.idx[0]) ?? null;
  if (verse) for (const i of verse[1].idx) name(i, 'Aメロ');
  if (verse) {
    const between = new Map<string, number>();
    for (const vi of verse[1].idx) {
      const ci = cg.idx.find((c) => c > vi);
      if (ci == null) continue;
      for (let i = vi + 1; i < ci; i++) {
        const g = secs[i].group;
        if (g && g !== chorus && g !== verse[0] && !introGroups.has(g) && (sung.get(g)?.idx.length ?? 0) >= 2) between.set(g, (between.get(g) ?? 0) + 1);
      }
    }
    const pre = [...between.entries()].sort((a, b) => b[1] - a[1])[0];
    if (pre) for (const i of sung.get(pre[0])!.idx) if (!out[secs[i].id]) name(i, 'Bメロ');
  }
  // 間奏：曲の途中の、繰り返さないパート
  for (let i = firstRepeat; i <= lastChorus; i++) if (!out[secs[i].id] && once(i)) name(i, '間奏');
  // 歌のない区間（イントロ前を除く）は、場所で イントロ・間奏・アウトロ にする。
  // ギターソロや、サビの伴奏だけが鳴る回（イントロ・間奏）を、サビ・Aメロにしない
  if (ref) {
    const singing = secs.map((_, i) => i >= head && sing(i));
    const first = singing.indexOf(true), last = singing.lastIndexOf(true);
    if (first >= 0) for (let i = head; i < secs.length; i++) if (!sing(i)) name(i, i < first ? 'イントロ' : i > last ? 'アウトロ' : '間奏');
    // 歌があるのに、繰り返さないためにイントロ・間奏などになった区間は、2回目のサビより前なら Aメロ、後なら Cメロ
    const second = cg.idx[1] ?? Infinity;
    for (let i = head; i < secs.length; i++) {
      const n = out[secs[i].id];
      if (sing(i) && (!n || n === 'イントロ' || n === '間奏' || n === 'アウトロ')) name(i, i < second ? 'Aメロ' : 'Cメロ');
    }
  }
  return out;
}

// 自動生成した構成に、名前の候補（Aメロ・サビなど）を最初から付けておく。
// 繰り返しの名前（groupNames）として付けるので、区間は「自動で付いた名前」のままで、手で直した区間とはみなさない。
// 同じ繰り返しでも場所で名前が違うもの（イントロの素材が間奏・アウトロで出てくるなど）は、区間ごとに付ける
// 名前の候補を付けるときに、隣り合う区間のうち同じ名前のものを1つにまとめる（余計な区切りを減らす）。
// 同じ繰り返しのもの（サビ 16小節＋サビ 14小節 など）と、曲に1度だけ出てくるまとまり（Cメロ・アウトロ）が細かく割れたものに限る。
// Aメロ・間奏などは、別々の区間が並ぶことがある（間奏1・間奏2、Aメロと Bメロの取り違え）のでまとめない。
// まとめた区間は、長いほうの繰り返しの記号を持ち、手で直した区間とはみなさない。
// まとめて MERGE_MAX_BARS 小節を超えるときはまとめない（変化の少ない部分が1つの長い区間にならないように。検証音源の正解の区間は最長 32小節）
const MERGE_NAMES = new Set(['Cメロ', 'アウトロ']);
const MERGE_MAX_BARS = 32;
function mergeSameNames(song: Song, names: Record<string, string>): Song {
  const out: Section[] = [];
  const w = (x: Section) => x.end - x.start;
  for (const s of song.sections) {
    const p = out[out.length - 1];
    const n = names[s.id];
    if (!p || !n || names[p.id] !== n || !s.nameAuto || !p.nameAuto || (p.group !== s.group && !MERGE_NAMES.has(n)) || (p.barsEst ?? 0) + (s.barsEst ?? 0) > MERGE_MAX_BARS) { out.push(s); continue; }
    const avgOf = (k: 'energy' | 'vocal', d: number) => (p[k] != null && s[k] != null ? Math.round(((p[k]! * w(p) + s[k]! * w(s)) / (w(p) + w(s))) * d) / d : p[k] ?? s[k]);
    out[out.length - 1] = { ...p, end: s.end, group: w(s) > w(p) ? s.group : p.group, energy: avgOf('energy', 10), vocal: avgOf('vocal', 1000) };
  }
  return { ...song, sections: out };
}

function withSuggestedNames(base: Song): Song {
  const names = suggestNames(base);
  const song = mergeSameNames(base, names);
  const groupNames = { ...song.groupNames };
  const mixed = new Set<string>();
  for (const s of song.sections) {
    const n = names[s.id];
    if (!n || !s.group || !s.nameAuto) continue;
    const first = song.sections.find((x) => x.group === s.group)!;
    if (names[first.id] !== n) mixed.add(s.group);
  }
  const sections = song.sections.map((s) => {
    const n = names[s.id];
    if (!n || !s.group || !s.nameAuto) return s;
    if (!mixed.has(s.group)) { if (!(s.group in groupNames)) groupNames[s.group] = n; return s; }
    return { ...s, name: n, nameAuto: false };
  });
  return normalize({ ...song, groupNames, sections });
}

// 名前の候補をまとめて付ける。名前を付けていない区間だけを対象にし、繰り返しは1回目に付けて同じ繰り返しへ広げる
export function applySuggestedNames(song: Song): Song {
  const names = suggestNames(song);
  let next = song;
  const done = new Set<string>();
  for (const s of song.sections) {
    const n = names[s.id];
    if (!n || !s.nameAuto) continue;
    // 同じ繰り返しでも場所で名前が違うもの（イントロの素材が間奏・アウトロで出てくるなど）は区間ごとに付ける
    const mixed = s.group && song.sections.some((x) => x.group === s.group && names[x.id] && names[x.id] !== n);
    if (s.group && !mixed) {
      if (done.has(s.group)) continue;
      done.add(s.group);
      const first = next.sections.find((x) => x.group === s.group)!;
      if (first.nameAuto) next = patchSection(next, first.id, { name: names[first.id] ?? n });
    } else next = patchSection(next, s.id, { name: n });
  }
  return next;
}

// ネット上の BPM（ref）を参考に、推定（est）が倍・半分を取り違えていないかを判定する。
// ネットの値は録音・アレンジの違いで数％ずれることがあるので、テンポそのものではなく倍率の判定にだけ使う。
// 2：推定は半分（2倍が正しい）、0.5：推定は2倍（半分が正しい）、1：合っている、null：判断できない
export function octaveByReference(est: number, ref: number, tolerance = 0.1): 2 | 0.5 | 1 | null {
  for (const f of [1, 2, 0.5] as const) if (Math.abs((est * f) / ref - 1) <= tolerance) return f;
  return null;
}

export const MIN_TAPS = 4;
// 人は音を聞いてから押すため、押した時刻は拍より少し遅れる。最初の拍の位置はこの分だけ前に寄せる（秒）
export const TAP_LATENCY = 0.05;

// 拍に合わせて押した時刻の列（秒）から、BPM と最初に押した拍の位置を求める。
// 押した回数と時刻の最小二乗直線を使い、1回ごとのばらつきをならす。押し損ねて1拍とんだ間隔は2拍分として数える
export function tapTempo(taps: number[]): { bpm: number; first: number } | null {
  if (taps.length < MIN_TAPS) return null;
  const gaps = taps.slice(1).map((t, i) => t - taps[i]);
  if (gaps.some((g) => !(g > 0))) return null;
  const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const idx = [0];
  for (const g of gaps) idx.push(idx[idx.length - 1] + Math.max(1, Math.round(g / median)));
  const n = taps.length;
  const mx = idx.reduce((p, v) => p + v, 0) / n, my = taps.reduce((p, v) => p + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (idx[i] - mx) * (taps[i] - my); sxx += (idx[i] - mx) ** 2; }
  const beat = sxy / sxx;
  const bpm = Math.round(600 / beat) / 10;
  if (!(bpm >= 20 && bpm <= 400)) return null;
  return { bpm, first: round3(Math.max(0, my - beat * mx - TAP_LATENCY)) };
}

// 最も近い拍の位置を返す
export function snapToBeat(song: Song, t: number): number {
  const beats = beatTimes(song);
  return beats ? timeAt(beats, Math.round(indexAt(beats, t))) : t;
}

// 最も近い小節の頭の位置を返す。anchor（その区間の始まりなど）を渡すと、そこから拍子の数ずつ拍を数えた位置に合わせる。
// 渡さなければ、最初の小節頭から通しで数えた小節の線に合わせる
export function snapToBar(song: Song, t: number, anchor?: number): number {
  if (anchor == null) {
    const lines = barLines(song);
    return lines ? timeAt(lines, Math.round(indexAt(lines, t))) : t;
  }
  const beats = beatTimes(song);
  if (!beats) return t;
  const perBar = Math.max(1, song.beatsPerBar);
  const k0 = Math.round(indexAt(beats, anchor));
  return timeAt(beats, k0 + Math.round((indexAt(beats, t) - k0) / perBar) * perBar);
}

// 区間の先頭から n 小節の位置（区間の始まりから拍を数える）。小節が未確定なら null
export function barPositionIn(song: Song, sec: Section, n: number): number | null {
  const beats = beatTimes(song);
  return beats ? timeAt(beats, Math.round(indexAt(beats, sec.start)) + n * Math.max(1, song.beatsPerBar)) : null;
}

// 自動解析の結果から曲メモを作る
export type AnalysisResult = {
  version: string;
  duration: number;
  bpm: number | null;
  beats: number[];
  firstDownbeat: number | null;
  beatsUncertain: boolean;
  segments: { start: number; end: number; group: string; energy?: number; vocal?: number }[];
  leadingSilence?: number; // 曲頭の無音（秒）。0 なら無音なし
  trailingSilence?: number; // 曲末の無音（秒）。0 なら無音なし
  chords?: ChordChange[]; // 推定したコードの変わり目（音源ファイルの秒）。N は和音なし
};

// 解析の結果（音源ファイルの時刻）を、曲の頭を 0:00 とする時刻に直す。曲頭・曲末の無音は構成に入れず、
// 曲頭の無音の長さ（lead）を音源ファイルのずれにする
function songTimes(a: Pick<AnalysisSnapshot, 'duration' | 'segments' | 'leadingSilence' | 'trailingSilence'>) {
  const segs = a.segments;
  if (!segs.length) return { lead: 0, duration: a.duration, sections: [] as Section[] };
  const lead = (a.leadingSilence ?? 0) > 0 && segs[0].end - a.leadingSilence! > MIN_SECTION ? round3(a.leadingSilence!) : 0;
  const last = segs[segs.length - 1];
  const cut = last.end - (a.trailingSilence ?? 0);
  const end = (a.trailingSilence ?? 0) > 0 && cut - Math.max(last.start, lead) > MIN_SECTION ? cut : last.end;
  const sections = segs.map((g, i) => newSection(round3((i === 0 ? lead : g.start) - lead), round3((i === segs.length - 1 ? end : g.end) - lead), { group: g.group, energy: g.energy, vocal: g.vocal }));
  return { lead, duration: sections[sections.length - 1].end, sections };
}

// 曲の頭（音源ファイルのずれ）を from から to に動かしたとき、YouTube のずれを保つ。音源ファイルなしで作った構成は対応が分からないので変えない
const keepYoutube = (song: Song, d: number): Partial<Song> =>
  song.audio && song.youtube && d ? { youtubeOffset: clampOffset((song.youtubeOffset ?? 0) + d) || undefined } : {};

export function songFromAnalysis(r: AnalysisResult, base?: Song): Song {
  const t = songTimes(r);
  const b = base ?? emptySong();
  const d = round3(t.lead - (b.audio?.offset ?? 0)); // 曲の頭が音源ファイルの上で後ろへ動いた秒数
  const song: Song = {
    ...b,
    ...keepYoutube(b, d),
    duration: t.duration,
    bpmEst: r.bpm,
    beats: r.beats.slice(0, LIMITS.beats).map((x) => round3(x - t.lead)),
    chords: chordsOf(r, t.lead),
    beatsUncertain: r.beatsUncertain,
    analysisVersion: r.version,
    sections: t.sections,
    analysis: snapshotOf(r),
    audio: { offset: t.lead, duration: r.duration },
    groupNames: {},
  };
  if (!b.firstDownbeatManual) song.firstDownbeat = r.firstDownbeat == null ? null : round3(r.firstDownbeat - t.lead);
  else if (b.audio && b.firstDownbeat != null) song.firstDownbeat = round3(b.firstDownbeat - d);
  return withSuggestedNames(normalize(song));
}

// 解析の結果のコードを、曲の頭からの時刻に直す（off：曲の頭が音源ファイルの何秒目か）
const chordsOf = (r: AnalysisResult, off: number): ChordChange[] | null =>
  r.chords ? r.chords.slice(0, LIMITS.chords).map((c) => ({ t: round3(c.t - off), chord: c.chord })) : null;

const snapshotOf = (r: AnalysisResult): AnalysisSnapshot => ({
  duration: r.duration, bpm: r.bpm, firstDownbeat: r.firstDownbeat, beatsUncertain: r.beatsUncertain,
  segments: r.segments.slice(0, LIMITS.sections).map(({ start, end, group, energy, vocal }) => ({ start, end, group, energy, vocal })),
  leadingSilence: r.leadingSilence ?? 0,
  trailingSilence: r.trailingSilence ?? 0,
});

// 構成を自動解析の結果に戻す。区間・テンポ・拍子・最初の小節頭の手動修正を捨てる（曲名・全体メモは残す）。
// 解析の結果（analysis）は音源ファイルの時刻のまま持ち、ここで曲の時刻に直す。拍（beats）は今の音源ファイルのずれに合わせてあるので、ずれの変化だけ動かす
export function resetToAnalysis(song: Song): Song {
  const a = song.analysis;
  if (!a || !a.segments.length) return song;
  const t = songTimes(a);
  const d = round3(t.lead - (song.audio?.offset ?? 0));
  return withSuggestedNames(normalize({
    ...song,
    ...keepYoutube(song, d),
    duration: t.duration,
    bpmEst: a.bpm,
    bpmManual: null,
    beatsPerBar: 4,
    beats: song.beats?.map((x) => round3(x - d)) ?? null,
    chords: song.chords?.map((c) => ({ ...c, t: round3(c.t - d) })) ?? null,
    firstDownbeat: a.firstDownbeat == null ? null : round3(a.firstDownbeat - t.lead),
    firstDownbeatManual: false,
    beatsUncertain: a.beatsUncertain,
    sections: t.sections,
    audio: { offset: t.lead, duration: a.duration },
    groupNames: {},
  }));
}

// 解析結果で構成を作り直す。手動修正はすべて捨てる（曲名・アーティスト・全体メモは残す）
export function regenerateFromAnalysis(song: Song, r: AnalysisResult): Song {
  const off = song.audio?.offset ?? 0;
  return resetToAnalysis({ ...song, beats: r.beats.slice(0, LIMITS.beats).map((x) => round3(x - off)), chords: chordsOf(r, off), analysisVersion: r.version, analysis: snapshotOf(r) });
}

// 解析の結果からコードだけを反映する。区間・名前・テンポなどはそのまま（区間ごとに手で入れたコードも残る）
export function adoptChords(song: Song, r: AnalysisResult): Song {
  return { ...song, chords: chordsOf(r, song.audio?.offset ?? 0) };
}

// 再解析の結果を採用する。手動修正済みの区間がある場合は区間を置き換えず、テンポの推定値だけ更新する
export function adoptAnalysis(song: Song, r: AnalysisResult): { song: Song; sectionsReplaced: boolean } {
  const anyEdited = song.sections.some((s) => s.edited);
  if (!anyEdited) return { song: songFromAnalysis(r, song), sectionsReplaced: true };
  // 区間はそのままなので、拍と最初の小節頭は今の音源ファイルのずれで曲の時刻に直す
  const off = song.audio?.offset ?? 0;
  const next: Song = {
    ...song,
    bpmEst: r.bpm,
    beats: r.beats.slice(0, LIMITS.beats).map((x) => round3(x - off)),
    chords: chordsOf(r, off),
    beatsUncertain: r.beatsUncertain,
    analysisVersion: r.version,
    firstDownbeat: song.firstDownbeatManual ? song.firstDownbeat : r.firstDownbeat == null ? null : round3(r.firstDownbeat - off),
    analysis: snapshotOf(r),
    audio: { offset: off, duration: r.duration },
  };
  return { song: normalize(next), sectionsReplaced: false };
}

// 保存前の検証。問題があれば理由を返す（API でも同じ検証を行う）
// ---- キーと移調 ----
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 選べるキー（長調12・短調12）。表記はよく使う方（E♭ は Eb、F# は F#）
export const KEYS = [...['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], ...['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm']];
// シャープで書くキー（それ以外はフラット。C・Am では B♭ のようにフラットで書くことが多い）
const SHARP_KEYS = new Set(['G', 'D', 'A', 'E', 'B', 'F#', 'Em', 'Bm', 'F#m', 'C#m', 'G#m']);

const pitchOf = (letter: string, acc: string) => (LETTER[letter] + (/[#♯]/.test(acc) ? 1 : /[b♭]/.test(acc) ? -1 : 0) + 12) % 12;
const KEY_RE = /^([A-G])([#♯b♭]?)(m?)$/;
// キーの主音（0〜11）。読めなければ null
export function keyRoot(key: string): number | null {
  const m = key.trim().match(KEY_RE);
  return m ? pitchOf(m[1], m[2]) : null;
}
// キーを半音 n だけ移したキー（シャープのキーならシャープ、それ以外はフラットで書く）
export function transposeKey(key: string, n: number): string | null {
  const m = key.trim().match(KEY_RE);
  if (!m) return null;
  const p = (pitchOf(m[1], m[2]) + n + 120) % 12;
  const sharp = SHARPS[p] + m[3];
  return SHARP_KEYS.has(sharp) ? sharp : FLATS[p] + m[3];
}
// キーの表示（Eb → E♭、F# → F♯）
export const keyLabel = (key: string) => key.replace(/([A-G])b/g, '$1♭').replace(/([A-G])#/g, '$1♯');

// コード進行の文字を半音 n だけ移調する。根音と分数コードの低音（/ や on の後ろ）だけを書き換える。
// toKey（移調後のキー）がシャープのキーならシャープで、それ以外（キーが分からないときも）はフラットで書く
export function transposeChords(text: string, n: number, toKey?: string | null): string {
  const k = ((n % 12) + 12) % 12;
  if (!k) return text;
  const names = toKey && SHARP_KEYS.has(toKey) ? SHARPS : FLATS;
  return text.replace(/(^|[\s|/(]|on)([A-G])([#♯b♭]?)/g, (_, pre: string, letter: string, acc: string) => pre + names[(pitchOf(letter, acc) + k) % 12]);
}

// 曲のキーの表示（例：原曲 E♭ → 演奏 D♭（-2））。何も設定されていなければ null
export function keySummary(song: Song): string | null {
  const t = song.transpose ?? 0, key = song.originalKey ?? null;
  const shift = t > 0 ? `+${t}` : `${t}`;
  if (!key) return t ? `原曲から ${shift}` : null;
  if (!t) return `キー ${keyLabel(key)}`;
  return `原曲 ${keyLabel(key)} → 演奏 ${keyLabel(transposeKey(key, t) ?? key)}（${shift}）`;
}

// アーティスト名が同じとみなせるか（全角半角・大文字小文字・空白・記号の違いは区別しない）。どちらかが空なら false
export function sameArtist(a: string, b: string): boolean {
  const n = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const x = n(a), y = n(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

// コード譜の URL として使える形に直す（https のみ）。使えなければ null
export function chordChartUrl(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > LIMITS.url) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}
// コード譜のリンクに出すサイト名
export const chordChartSite = (url: string) => {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return host === 'ufret.jp' ? 'U-FRET' : host;
};

// 時刻 t に鳴っている推定のコード（N は和音なし）。推定がなければ null
export function chordAt(track: ChordChange[], t: number): string | null {
  let lo = 0, hi = track.length - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t + 1e-6) { at = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return at >= 0 ? track[at].chord : null;
}
const chordLabel = (c: string | null) => (c == null || c === 'N' ? '-' : c);

// 推定のコードから、区間のコード進行を1行で作る（例：| Am | Am G | F | E7 |）。
// 小節の線が分かれば1小節ずつ、前半と後半で多い方のコードを書く（同じなら1つ）。分からなければ変わり目の順に並べる
export function estimatedChords(song: Song, sec: Section): string | null {
  const track = song.chords;
  if (!track?.length) return null;
  const beats = beatsWithBars(song)?.filter((b) => b.t >= sec.start - 0.05 && b.t < sec.end - 0.05);
  if (!beats?.length) {
    const seq: string[] = [];
    const first = chordAt(track, sec.start + 0.05);
    if (first) seq.push(chordLabel(first));
    for (const c of track) if (c.t > sec.start + 0.05 && c.t < sec.end - 0.05 && chordLabel(c.chord) !== seq[seq.length - 1]) seq.push(chordLabel(c.chord));
    return seq.length ? seq.join(' ') : null;
  }
  const bars: string[][] = [];
  for (const b of beats) {
    if (b.head || !bars.length) bars.push([]);
    bars[bars.length - 1].push(chordLabel(chordAt(track, b.t + 0.05)));
  }
  const most = (xs: string[]) => {
    const n = new Map<string, number>();
    for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1])[0][0];
  };
  const cells = bars.map((bar) => {
    const half = Math.ceil(bar.length / 2);
    const a = most(bar.slice(0, half)), b = bar.length > 1 ? most(bar.slice(half)) : a;
    return a === b ? a : `${a} ${b}`;
  });
  return `| ${cells.join(' | ')} |`;
}

// 区間に表示するコード進行。手で入れたもの、繰り返しの1回目に手で入れたもの、推定の順に使う。
// コード進行は「今どこにいるかの目印」と「繰り返しの違いに気づく」ためのもの（演奏用のコード譜ではない）。
// 推定は書き起こしの下書きとして編集画面だけで使い、閲覧ページ・テキストには手で入れた（確かめた）ものだけを出す
export function sectionChords(song: Song, sec: Section): { text: string; source: 'manual' | 'repeat' | 'estimate' } | null {
  if (sec.chords != null) return { text: sec.chords, source: 'manual' };
  const first = sec.group ? song.sections.find((x) => x.group === sec.group) : undefined;
  if (first && first !== sec && first.chords) return { text: first.chords, source: 'repeat' };
  const est = estimatedChords(song, sec);
  return est ? { text: est, source: 'estimate' } : null;
}

// 手で入れた（確かめた）コード進行だけ。閲覧ページとテキストの書き出しに使う
export function confirmedChords(song: Song, sec: Section): { text: string; source: 'manual' | 'repeat' } | null {
  const c = sectionChords(song, sec);
  return c && c.source !== 'estimate' && c.text.trim() ? { text: c.text, source: c.source } : null;
}

// 繰り返しの2回目以降で、1回目に手で入れたコード進行と違うものを入れたか（「2回目のサビだけ最後が違う」などに気づけるようにする）
export function chordsDifferFromFirst(song: Song, sec: Section): boolean {
  const first = sec.group ? song.sections.find((x) => x.group === sec.group) : undefined;
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
  return !!first && first !== sec && first.chords != null && sec.chords != null && norm(first.chords) !== norm(sec.chords);
}

export function validateSong(x: unknown): string | null {
  const s = x as Song;
  if (!s || typeof s !== 'object') return '形式が正しくありません';
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const numOrNull = (v: unknown) => v === null || num(v);
  if (!str(s.title, LIMITS.text) || !str(s.artist, LIMITS.text) || !str(s.memo, LIMITS.memo)) return '曲名・アーティスト・メモが長すぎます';
  if (!num(s.duration) || s.duration < 0 || s.duration > LIMITS.duration) return '曲の長さが正しくありません';
  if (!numOrNull(s.bpmEst) || !numOrNull(s.bpmManual) || !numOrNull(s.firstDownbeat)) return 'テンポが正しくありません';
  if (s.bpmManual != null && (s.bpmManual < 20 || s.bpmManual > 400)) return 'BPMは20〜400で指定してください';
  if (!Number.isInteger(s.beatsPerBar) || s.beatsPerBar < 1 || s.beatsPerBar > 16) return '拍子が正しくありません';
  if (s.beats !== null && (!Array.isArray(s.beats) || s.beats.length > LIMITS.beats || !s.beats.every(num))) return '拍位置が正しくありません';
  if (!Array.isArray(s.sections) || s.sections.length > LIMITS.sections) return '区間が多すぎます';
  let t = 0;
  for (const [i, sec] of s.sections.entries()) {
    if (!sec || !str(sec.id, 32) || !str(sec.name, LIMITS.text) || !str(sec.memo, LIMITS.memo)) return `区間${i + 1}の内容が正しくありません`;
    if (!num(sec.start) || !num(sec.end) || sec.end <= sec.start) return `区間${i + 1}の時刻が正しくありません`;
    if (Math.abs(sec.start - t) > 1e-6) return `区間${i + 1}の前に隙間か重なりがあります`;
    if (sec.group !== null && !str(sec.group, 8)) return `区間${i + 1}の繰り返しが正しくありません`;
    if (!numOrNull(sec.barsEst) || !numOrNull(sec.barsManual)) return `区間${i + 1}の小節数が正しくありません`;
    if (sec.chords != null && !str(sec.chords, LIMITS.chordText)) return `区間${i + 1}のコード進行が長すぎます`;
    if ((sec.cut != null && typeof sec.cut !== 'boolean') || (sec.arrange != null && !str(sec.arrange, LIMITS.text))) return `区間${i + 1}の原曲との違いが正しくありません`;
    t = sec.end;
  }
  if (s.sections.length && Math.abs(t - s.duration) > 1e-6) return '最後の区間が曲の終わりと一致しません';
  if (s.groupNames != null && (typeof s.groupNames !== 'object' || Object.keys(s.groupNames).length > 100 || !Object.values(s.groupNames).every((v) => str(v, LIMITS.text)))) return '繰り返しの名前が正しくありません';
  if (s.youtube != null && (typeof s.youtube !== 'string' || !YOUTUBE_ID.test(s.youtube))) return 'YouTube の動画が正しくありません';
  if (s.youtubeOffset != null && (!num(s.youtubeOffset) || Math.abs(s.youtubeOffset) > MAX_YOUTUBE_OFFSET)) return 'YouTube の動画のずれが正しくありません';
  if (s.audio != null && (typeof s.audio !== 'object' || !num(s.audio.offset) || !num(s.audio.duration) || s.audio.offset < 0 || s.audio.duration < 0 || s.audio.duration > LIMITS.duration)) return '音源ファイルの情報が正しくありません';
  if (s.originalKey != null && (typeof s.originalKey !== 'string' || keyRoot(s.originalKey) == null)) return '原曲のキーが正しくありません';
  if (s.transpose != null && (!Number.isInteger(s.transpose) || Math.abs(s.transpose) > 11)) return '移調が正しくありません';
  if (s.chordChartUrl != null && (typeof s.chordChartUrl !== 'string' || chordChartUrl(s.chordChartUrl) !== s.chordChartUrl)) return 'コード譜の URL が正しくありません';
  if (s.chords != null && (!Array.isArray(s.chords) || s.chords.length > LIMITS.chords || !s.chords.every((c) => c && num(c.t) && str(c.chord, 16)))) return 'コードが正しくありません';
  if (s.analysis != null && (typeof s.analysis !== 'object' || !Array.isArray(s.analysis.segments) || s.analysis.segments.length > LIMITS.sections)) return '自動解析の結果が正しくありません';
  return null;
}
