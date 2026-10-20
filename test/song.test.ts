import { describe, expect, it } from 'vitest';
import {
  adoptAnalysis, appendSection, deleteSection, emptySong, mergeWithNext, moveBoundary, newSection,
  normalize, patchSection, setGroup, setTempo, snapToBeat, splitAt, validateSong, type Song,
} from '../shared/song';
import { diffSongs } from '../shared/diff';

// 120BPM・4/4（1小節2秒）、イントロ8小節・A16小節・B8小節・A再登場16小節
function sample(): Song {
  const s = emptySong(96);
  s.bpmEst = 120;
  s.firstDownbeat = 0;
  s.sections = [
    newSection(0, 16, { group: 'A' }),
    newSection(16, 48, { group: 'B' }),
    newSection(48, 64, { group: 'C' }),
    newSection(64, 96, { group: 'B' }),
  ];
  return normalize(s);
}

const invariant = (s: Song) => expect(validateSong(s)).toBeNull();

describe('編集ルール', () => {
  it('推定小節数と自動の名前を付ける', () => {
    const s = sample();
    expect(s.sections.map((x) => x.barsEst)).toEqual([8, 16, 8, 16]);
    expect(s.sections.map((x) => x.name)).toEqual(['区間A', '区間B', '区間C', '区間B再登場']);
    invariant(s);
  });

  it('境界を動かすと隣の区間も変わり、前後の境界の内側に制限される', () => {
    const s = sample();
    const moved = moveBoundary(s, 1, 20);
    expect([moved.sections[0].end, moved.sections[1].start]).toEqual([20, 20]);
    const clamped = moveBoundary(s, 1, 100);
    expect(clamped.sections[1].start).toBeLessThan(48);
    expect(clamped.sections[1].start).toBeGreaterThan(0);
    invariant(moved);
    invariant(clamped);
  });

  it('分割すると後半は新しい区間になる', () => {
    const s = splitAt(sample(), 32);
    expect(s.sections).toHaveLength(5);
    expect(s.sections[1].end).toBe(32);
    expect(s.sections[2]).toMatchObject({ start: 32, end: 48, group: null, name: '区間' });
    invariant(s);
  });

  it('削除は直前の区間と結合し、直前の区間の名前などを引き継ぐ', () => {
    const base = sample();
    const s0 = patchSection(base, base.sections[1].id, { name: 'Aメロ', memo: '抑えめ' });
    const s = deleteSection(s0, s0.sections[2].id);
    expect(s.sections).toHaveLength(3);
    expect(s.sections[1]).toMatchObject({ start: 16, end: 64, name: 'Aメロ', memo: '抑えめ' });
    invariant(s);
  });

  it('先頭区間の削除だけは直後の区間と結合する', () => {
    const s0 = sample();
    const s = deleteSection(s0, s0.sections[0].id);
    expect(s.sections[0]).toMatchObject({ id: s0.sections[1].id, start: 0, end: 48 });
    invariant(s);
  });

  it('結合時の手動小節数：両方手動なら合計、片方だけなら推定に戻して要確認', () => {
    let s = sample();
    s = patchSection(s, s.sections[0].id, { barsManual: 9 });
    s = patchSection(s, s.sections[1].id, { barsManual: 15 });
    expect(mergeWithNext(s, s.sections[0].id).sections[0]).toMatchObject({ barsManual: 24, barsNeedsCheck: false });
    const t = sample();
    const u = patchSection(t, t.sections[0].id, { barsManual: 9 });
    expect(mergeWithNext(u, u.sections[0].id).sections[0]).toMatchObject({ barsManual: null, barsNeedsCheck: true, barsEst: 24 });
  });

  it('区間が1つのときは削除しない', () => {
    const s = normalize({ ...emptySong(10), sections: [newSection(0, 10)] });
    expect(deleteSection(s, s.sections[0].id)).toBe(s);
  });

  it('反復グループの付け替えで自動の名前は変わり、利用者が付けた名前は残る', () => {
    let s = sample();
    s = setGroup(s, s.sections[2].id, 'B');
    expect(s.sections[2]).toMatchObject({ group: 'B', name: '区間B再登場', groupManual: true });
    s = patchSection(s, s.sections[3].id, { name: 'サビ' });
    s = setGroup(s, s.sections[3].id, 'new');
    expect(s.sections[3]).toMatchObject({ group: 'C', name: 'サビ' });
    s = setGroup(s, s.sections[0].id, null);
    expect(s.sections[0]).toMatchObject({ group: null, name: '区間' });
  });

  it('テンポを手動で変えると推定小節数が再計算され、手動小節数は残る', () => {
    let s = sample();
    s = patchSection(s, s.sections[1].id, { barsManual: 17 });
    s = setTempo(s, { bpmManual: 60 });
    expect(s.sections.map((x) => x.barsEst)).toEqual([4, 8, 4, 8]);
    expect(s.sections[1].barsManual).toBe(17);
  });

  it('拍へのスナップ', () => {
    const s = setTempo(sample(), { firstDownbeat: 0.1 });
    expect(snapToBeat(s, 1.32)).toBeCloseTo(1.1);
  });

  it('音源なしで末尾に区間を追加できる', () => {
    let s = normalize({ ...emptySong(0), bpmManual: 120 });
    s = appendSection(s);
    s = appendSection(s);
    expect(s.duration).toBe(32);
    expect(s.sections.map((x) => x.barsEst)).toEqual([8, 8]);
    invariant(s);
  });

  it('再解析の採用：手動修正があれば区間は置き換えない', () => {
    const r = { version: 't', duration: 96, bpm: 121, beats: [], firstDownbeat: 0.2, beatsUncertain: false, segments: [{ start: 0, end: 96, group: 'A' }] };
    const clean = adoptAnalysis(sample(), r);
    expect(clean.sectionsReplaced).toBe(true);
    expect(clean.song.sections).toHaveLength(1);
    const base = sample();
    const edited = patchSection(base, base.sections[0].id, { name: 'イントロ' });
    const kept = adoptAnalysis(edited, r);
    expect(kept.sectionsReplaced).toBe(false);
    expect(kept.song.sections).toHaveLength(4);
    expect(kept.song.bpmEst).toBe(121);
  });

  it('検証：隙間・重なり・末尾の不一致を拒否する', () => {
    const s = sample();
    expect(validateSong({ ...s, sections: [s.sections[0], s.sections[2]] })).toMatch(/隙間/);
    expect(validateSong({ ...s, duration: 100 })).toMatch(/終わり/);
    expect(validateSong(null)).not.toBeNull();
  });
});

describe('版の差分', () => {
  it('変更がなければ changed は false', () => {
    const s = sample();
    expect(diffSongs(s, s).changed).toBe(false);
  });

  it('分割・結合・名前・反復グループ・小節数・メモの変更を区間ごとに示す', () => {
    const prev = sample();
    let next = splitAt(prev, 32);
    expect(diffSongs(prev, next).sections[next.sections[1].id]).toEqual(['split', 'bars']);
    expect(diffSongs(prev, next).sections[next.sections[2].id]).toEqual(['split']);

    next = deleteSection(prev, prev.sections[2].id);
    const d = diffSongs(prev, next);
    expect(d.sections[prev.sections[1].id]).toEqual(['bars', 'merged']);
    expect(d.removed).toHaveLength(0);

    next = patchSection(prev, prev.sections[3].id, { name: 'サビ', memo: '全員で', barsManual: 17 });
    next = setGroup(next, next.sections[0].id, 'new');
    const e = diffSongs(prev, next);
    expect(e.sections[prev.sections[3].id]).toEqual(['name', 'bars', 'memo']);
    expect(e.sections[prev.sections[0].id]).toEqual(['name', 'group']);
  });

  it('境界の移動とテンポの変更', () => {
    const prev = sample();
    const next = setTempo(moveBoundary(prev, 2, 50), { bpmManual: 100 });
    const d = diffSongs(prev, next);
    expect(d.sections[prev.sections[1].id]).toContain('boundary');
    expect(d.song).toContain('テンポ');
  });
});
