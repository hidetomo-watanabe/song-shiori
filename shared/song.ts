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
  silence?: boolean; // 曲頭・曲末の無音。小節数を数えない
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
};

// 区間の名前の候補（入力欄で選べる）
export const SECTION_NAMES = ['イントロ', 'Aメロ', 'Bメロ', 'Cメロ', 'サビ', '大サビ', '落ちサビ', '間奏', 'ソロ', 'ブレイク', 'アウトロ'];

export type AnalysisSnapshot = {
  duration: number;
  bpm: number | null;
  firstDownbeat: number | null;
  beatsUncertain: boolean;
  segments: { start: number; end: number; group: string }[];
  leadingSilence?: number; // 曲頭の無音（秒）
  trailingSilence?: number; // 曲末の無音（秒）
};

export const MIN_SECTION = 0.5; // 区間の最短長（秒）
export const LIMITS = { sections: 300, beats: 4000, text: 200, memo: 2000, duration: 3600 };

export const newId = () => {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const bpmOf = (s: Song) => s.bpmManual ?? s.bpmEst;
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

// 小節の頭の位置の列（秒）。最初の小節頭に最も近い拍から、拍子の数ごとに取る
export function barLines(s: Song): number[] | null {
  const beats = beatGrid(s);
  if (!beats || beats.length < 2) return null;
  const origin = s.firstDownbeat ?? beats[0];
  let phase = 0;
  for (let i = 1; i < beats.length; i++) if (Math.abs(beats[i] - origin) < Math.abs(beats[phase] - origin)) phase = i;
  const n = Math.max(1, s.beatsPerBar);
  const lines = beats.filter((_, i) => (((i - phase) % n) + n) % n === 0);
  return lines.length >= 2 ? lines : null;
}

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

// 推定小節数を再計算し、自動の名前を付け直す
export function normalize(song: Song): Song {
  // 小節数は区間ごとに、その区間の始まりから拍を数えて求める（拍の数 ÷ 拍子）。
  // 曲の頭から通しで数えると、最初の小節頭のずれや途中の2拍だけの小節が、後ろの区間すべてに持ち越されるため
  const beats = beatGrid(song);
  const perBar = Math.max(1, song.beatsPerBar);
  const total = new Map<string, number>();
  for (const s of song.sections) if (s.group) total.set(s.group, (total.get(s.group) ?? 0) + 1);
  const seen = new Map<string, number>();
  const sections = song.sections.map((s) => {
    const barsEst = beats && !s.silence ? Math.max(0, Math.round((indexAt(beats, s.end) - indexAt(beats, s.start)) / perBar)) : null;
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

// 位置 t で区間を2つに分ける。後半は名前・繰り返し・メモを持たない新しい区間になる
export function splitAt(song: Song, t: number): Song {
  const i = song.sections.findIndex((s) => t > s.start + MIN_SECTION && t < s.end - MIN_SECTION);
  if (i < 0) return song;
  const cur = song.sections[i];
  const total = cur.barsManual ?? cur.barsEst;
  const second = newSection(t, cur.end, { edited: true });
  const pair = (partner: string) => (total != null ? { partner, total, start: cur.start, end: cur.end } : null);
  second.split = pair(cur.id);
  const next = song.sections.slice();
  next.splice(i, 1, { ...cur, end: t, barsManual: null, edited: true, split: pair(second.id) }, second);
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

export function patchSection(song: Song, id: string, patch: Partial<Pick<Section, 'name' | 'memo' | 'barsManual'>>): Song {
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
  return normalize(s);
}

// ネット上の BPM（ref）を参考に、推定（est）が倍・半分を取り違えていないかを判定する。
// ネットの値は録音・アレンジの違いで数％ずれることがあるので、テンポそのものではなく倍率の判定にだけ使う。
// 2：推定は半分（2倍が正しい）、0.5：推定は2倍（半分が正しい）、1：合っている、null：判断できない
export function octaveByReference(est: number, ref: number, tolerance = 0.1): 2 | 0.5 | 1 | null {
  for (const f of [1, 2, 0.5] as const) if (Math.abs((est * f) / ref - 1) <= tolerance) return f;
  return null;
}

// 最も近い拍の位置を返す
export function snapToBeat(song: Song, t: number): number {
  const beats = beatGrid(song);
  return beats ? timeAt(beats, Math.round(indexAt(beats, t))) : t;
}

// 最も近い小節の頭の位置を返す。anchor（その区間の始まりなど）を渡すと、そこから拍子の数ずつ拍を数えた位置に合わせる。
// 渡さなければ、最初の小節頭から通しで数えた小節の線に合わせる
export function snapToBar(song: Song, t: number, anchor?: number): number {
  if (anchor == null) {
    const lines = barLines(song);
    return lines ? timeAt(lines, Math.round(indexAt(lines, t))) : t;
  }
  const beats = beatGrid(song);
  if (!beats) return t;
  const perBar = Math.max(1, song.beatsPerBar);
  const k0 = Math.round(indexAt(beats, anchor));
  return timeAt(beats, k0 + Math.round((indexAt(beats, t) - k0) / perBar) * perBar);
}

// 区間の先頭から n 小節の位置（区間の始まりから拍を数える）。小節が未確定なら null
export function barPositionIn(song: Song, sec: Section, n: number): number | null {
  const beats = beatGrid(song);
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
  segments: { start: number; end: number; group: string }[];
  leadingSilence?: number; // 曲頭の無音（秒）。0 なら無音なし
  trailingSilence?: number; // 曲末の無音（秒）。0 なら無音なし
};

// 解析の区切りから区間を作る。曲頭・曲末に無音があれば「無音（曲の前）」「無音（曲の後）」として分け、
// 構成は音が鳴っている間だけにする
function sectionsFrom(segments: AnalysisResult['segments'], leadingSilence = 0, trailingSilence = 0): Section[] {
  const secs = segments.map((g) => newSection(g.start, g.end, { group: g.group }));
  if (leadingSilence > 0 && secs.length && secs[0].end - leadingSilence > MIN_SECTION) {
    secs[0] = { ...secs[0], start: leadingSilence };
    secs.unshift(newSection(0, leadingSilence, { name: '無音（曲の前）', nameAuto: false, silence: true }));
  }
  const last = secs[secs.length - 1];
  const end = last ? last.end - trailingSilence : 0;
  if (trailingSilence > 0 && last && !last.silence && end - last.start > MIN_SECTION) {
    secs[secs.length - 1] = { ...last, end };
    secs.push(newSection(end, last.end, { name: '無音（曲の後）', nameAuto: false, silence: true }));
  }
  return secs;
}

export function songFromAnalysis(r: AnalysisResult, base?: Song): Song {
  const song: Song = {
    ...(base ?? emptySong()),
    duration: r.duration,
    bpmEst: r.bpm,
    beats: r.beats.slice(0, LIMITS.beats),
    beatsUncertain: r.beatsUncertain,
    analysisVersion: r.version,
    sections: sectionsFrom(r.segments, r.leadingSilence, r.trailingSilence),
    analysis: snapshotOf(r),
    groupNames: {},
  };
  if (!base?.firstDownbeatManual) song.firstDownbeat = r.firstDownbeat;
  return normalize(song);
}

const snapshotOf = (r: AnalysisResult): AnalysisSnapshot => ({
  duration: r.duration, bpm: r.bpm, firstDownbeat: r.firstDownbeat, beatsUncertain: r.beatsUncertain,
  segments: r.segments.slice(0, LIMITS.sections).map(({ start, end, group }) => ({ start, end, group })),
  leadingSilence: r.leadingSilence ?? 0,
  trailingSilence: r.trailingSilence ?? 0,
});

// 構成を自動解析の結果に戻す。区間・テンポ・拍子・最初の小節頭の手動修正を捨てる（曲名・全体メモは残す）
export function resetToAnalysis(song: Song): Song {
  const a = song.analysis;
  if (!a || !a.segments.length) return song;
  return normalize({
    ...song,
    duration: a.duration,
    bpmEst: a.bpm,
    bpmManual: null,
    beatsPerBar: 4,
    firstDownbeat: a.firstDownbeat,
    firstDownbeatManual: false,
    beatsUncertain: a.beatsUncertain,
    sections: sectionsFrom(a.segments, a.leadingSilence, a.trailingSilence),
    groupNames: {},
  });
}

// 解析結果で構成を作り直す。手動修正はすべて捨てる（曲名・アーティスト・全体メモは残す）
export function regenerateFromAnalysis(song: Song, r: AnalysisResult): Song {
  return resetToAnalysis({ ...song, beats: r.beats.slice(0, LIMITS.beats), analysisVersion: r.version, analysis: snapshotOf(r) });
}

// 再解析の結果を採用する。手動修正済みの区間がある場合は区間を置き換えず、テンポの推定値だけ更新する
export function adoptAnalysis(song: Song, r: AnalysisResult): { song: Song; sectionsReplaced: boolean } {
  const anyEdited = song.sections.some((s) => s.edited);
  if (!anyEdited) return { song: songFromAnalysis(r, song), sectionsReplaced: true };
  const next: Song = {
    ...song,
    bpmEst: r.bpm,
    beats: r.beats.slice(0, LIMITS.beats),
    beatsUncertain: r.beatsUncertain,
    analysisVersion: r.version,
    firstDownbeat: song.firstDownbeatManual ? song.firstDownbeat : r.firstDownbeat,
    analysis: snapshotOf(r),
  };
  return { song: normalize(next), sectionsReplaced: false };
}

// 保存前の検証。問題があれば理由を返す（API でも同じ検証を行う）
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
    t = sec.end;
  }
  if (s.sections.length && Math.abs(t - s.duration) > 1e-6) return '最後の区間が曲の終わりと一致しません';
  if (s.groupNames != null && (typeof s.groupNames !== 'object' || Object.keys(s.groupNames).length > 100 || !Object.values(s.groupNames).every((v) => str(v, LIMITS.text)))) return '繰り返しの名前が正しくありません';
  if (s.analysis != null && (typeof s.analysis !== 'object' || !Array.isArray(s.analysis.segments) || s.analysis.segments.length > LIMITS.sections)) return '自動解析の結果が正しくありません';
  return null;
}
