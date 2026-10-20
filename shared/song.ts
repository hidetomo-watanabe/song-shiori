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
};

export type AnalysisSnapshot = {
  duration: number;
  bpm: number | null;
  firstDownbeat: number | null;
  beatsUncertain: boolean;
  segments: { start: number; end: number; group: string }[];
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
export const barSeconds = (s: Song) => {
  const bpm = bpmOf(s);
  return bpm && hasGrid(s) ? (60 / bpm) * s.beatsPerBar : null;
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
  const bar = barSeconds(song);
  const total = new Map<string, number>();
  for (const s of song.sections) if (s.group) total.set(s.group, (total.get(s.group) ?? 0) + 1);
  const seen = new Map<string, number>();
  const sections = song.sections.map((s) => {
    const barsEst = bar ? Math.max(0, Math.round((s.end - s.start) / bar)) : null;
    let name = s.name;
    if (s.nameAuto) {
      // 例：パートA（1回目）・パートA（2回目）。1回しか出てこなければ「パートA」
      const n = s.group ? (seen.get(s.group) ?? 0) + 1 : 0;
      name = !s.group ? 'パート' : (total.get(s.group) ?? 0) > 1 ? `パート${s.group}（${n}回目）` : `パート${s.group}`;
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
  if ('name' in patch) s.nameAuto = false;
  if ('barsManual' in patch) s.barsNeedsCheck = false;
  next[i] = s;
  // 分割した片方の小節数を入れたら、もう片方を残りの小節数にする
  const p = 'barsManual' in patch && s.barsManual != null ? splitPartner(next, s) : null;
  if (p && s.barsManual! <= s.split!.total) {
    next[next.indexOf(p)] = { ...p, barsManual: s.split!.total - s.barsManual!, barsNeedsCheck: false, edited: true };
  }
  return update(song, next);
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

// テンポ・拍子・最初の小節頭から、最も近い拍の位置を返す
export function snapToBeat(song: Song, t: number): number {
  const bpm = bpmOf(song);
  if (!bpm || !hasGrid(song)) return t;
  const beat = 60 / bpm;
  const origin = song.firstDownbeat ?? 0;
  return origin + Math.round((t - origin) / beat) * beat;
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
};

export function songFromAnalysis(r: AnalysisResult, base?: Song): Song {
  const song: Song = {
    ...(base ?? emptySong()),
    duration: r.duration,
    bpmEst: r.bpm,
    beats: r.beats.slice(0, LIMITS.beats),
    beatsUncertain: r.beatsUncertain,
    analysisVersion: r.version,
    sections: r.segments.map((g) => newSection(g.start, g.end, { group: g.group })),
    analysis: snapshotOf(r),
  };
  if (!base?.firstDownbeatManual) song.firstDownbeat = r.firstDownbeat;
  return normalize(song);
}

const snapshotOf = (r: AnalysisResult): AnalysisSnapshot => ({
  duration: r.duration, bpm: r.bpm, firstDownbeat: r.firstDownbeat, beatsUncertain: r.beatsUncertain,
  segments: r.segments.slice(0, LIMITS.sections).map(({ start, end, group }) => ({ start, end, group })),
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
    sections: a.segments.map((g) => newSection(g.start, g.end, { group: g.group })),
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
  if (s.analysis != null && (typeof s.analysis !== 'object' || !Array.isArray(s.analysis.segments) || s.analysis.segments.length > LIMITS.sections)) return '自動解析の結果が正しくありません';
  return null;
}
