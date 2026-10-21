// 2つの版の差分（要件定義書 5.5）。区間は ID で対応付ける
import { trimSilence, type Section, type Song } from './song.ts';

export type Change = 'added' | 'split' | 'merged' | 'boundary' | 'name' | 'group' | 'bars' | 'memo' | 'chords' | 'arrange';

export const CHANGE_LABEL: Record<Change, string> = {
  added: '追加', split: '分割', merged: '結合', boundary: '境界移動',
  name: '名前変更', group: '繰り返し変更', bars: '小節数変更', memo: 'メモ変更', chords: 'コード変更', arrange: '原曲との違いの変更',
};

export type SongDiff = {
  sections: Record<string, Change[]>; // 新しい版の区間ID → 変更の種類
  removed: Section[]; // 削除され、どこにも結合されていない区間
  song: string[]; // 曲全体の変更（テンポ等）
  changed: boolean;
};

const EPS = 0.01;
const bars = (s: Section) => s.barsManual ?? s.barsEst;
const inside = (a: Section, b: Section) => a.start >= b.start - EPS && a.end <= b.end + EPS;

export function diffSongs(prevSong: Song, nextSong: Song): SongDiff {
  // 以前の形式（無音の区間）を直してから比べる。形式を直しただけで「変更あり」にしない
  const prev = trimSilence(prevSong), next = trimSilence(nextSong);
  const before = new Map(prev.sections.map((s) => [s.id, s]));
  const after = new Set(next.sections.map((s) => s.id));
  const sections: Record<string, Change[]> = {};
  const add = (id: string, c: Change) => {
    const list = (sections[id] ??= []);
    if (!list.includes(c)) list.push(c);
  };

  for (const s of next.sections) {
    const old = before.get(s.id);
    if (!old) {
      // 既存の区間の内側に新しくできた区間は「分割」
      add(s.id, prev.sections.some((p) => after.has(p.id) && inside(s, p)) ? 'split' : 'added');
      continue;
    }
    if (Math.abs(old.start - s.start) > EPS || Math.abs(old.end - s.end) > EPS) add(s.id, 'boundary');
    if (old.name !== s.name) add(s.id, 'name');
    if (old.group !== s.group) add(s.id, 'group');
    if (bars(old) !== bars(s)) add(s.id, 'bars');
    if (old.memo !== s.memo) add(s.id, 'memo');
    if ((old.chords ?? null) !== (s.chords ?? null)) add(s.id, 'chords');
    if (!!old.cut !== !!s.cut || (old.arrange ?? '') !== (s.arrange ?? '')) add(s.id, 'arrange');
  }

  const removed: Section[] = [];
  for (const p of prev.sections) {
    if (after.has(p.id)) continue;
    const into = next.sections.find((s) => before.has(s.id) && inside(p, s));
    if (into) {
      add(into.id, 'merged');
      sections[into.id] = sections[into.id].filter((c) => c !== 'boundary');
    } else removed.push(p);
  }
  // 分割された元の区間は、終了位置の変化を「分割」として示す
  for (const s of next.sections) {
    if (sections[s.id]?.includes('boundary') && next.sections.some((n) => sections[n.id]?.includes('split') && Math.abs(n.start - s.end) < EPS)) {
      sections[s.id] = sections[s.id].map((c) => (c === 'boundary' ? 'split' : c));
    }
  }

  const song: string[] = [];
  const bpm = (x: Song) => x.bpmManual ?? x.bpmEst;
  if (prev.title !== next.title || prev.artist !== next.artist) song.push('曲名・アーティスト');
  if (bpm(prev) !== bpm(next)) song.push('テンポ');
  if (prev.beatsPerBar !== next.beatsPerBar) song.push('拍子');
  // 最初の小節頭は小節の線を合わせるための編集用の設定なので知らせない（小節数が変われば区間の「小節数変更」で分かる）
  if (prev.memo !== next.memo) song.push('全体メモ');
  if ((prev.chordChartUrl ?? null) !== (next.chordChartUrl ?? null)) song.push('コード譜');
  if ((prev.originalKey ?? null) !== (next.originalKey ?? null) || (prev.transpose ?? 0) !== (next.transpose ?? 0)) song.push('キー');
  if ((prev.youtube ?? null) !== (next.youtube ?? null) || (prev.youtubeOffset ?? 0) !== (next.youtubeOffset ?? 0)) song.push('YouTube の動画');

  const changed = song.length > 0 || removed.length > 0 || Object.keys(sections).length > 0;
  return { sections, removed, song, changed };
}
