import { describe, expect, it } from 'vitest';
import {
  adoptAnalysis, appendSection, deleteSection, emptySong, mergeWithNext, moveBoundary, newSection,
  applySuggestedNames, barPositionIn, pickupBeats, pickupChoices, setPickup, sectionBpm, normalize, suggestNames, octaveByReference, usesDetectedBeats, patchSection, regenerateFromAnalysis, snapToBar, resetToAnalysis, setGroup, setTempo, snapToBeat, songFromAnalysis, splitAt, validateSong, youtubeId, clampOffset, trimSilence, sectionAt, wholeSong, beatClicks, barLines, tapTempo, TAP_LATENCY, estimatedChords, sectionChords, adoptChords, confirmedChords, chordsDifferFromFirst, sameArtist, transposeKey, transposeChords, keySummary, type Song,
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
  it('最初の小節頭より前の拍（弱起）は、最初の区間の小節数に含めず、拍の数で示す', () => {
    // 120BPM・4/4（1拍0.5秒）。曲の頭に1.5拍、そのあとイントロ4小節（8秒）、Aメロ8小節
    const s = normalize({ ...emptySong(24.75), bpmEst: 120, firstDownbeat: 0.75, sections: [newSection(0, 8.75), newSection(8.75, 24.75)] });
    expect(s.sections.map((x) => x.barsEst)).toEqual([4, 8]);
    expect(s.sections.map((x) => pickupBeats(s, x))).toEqual([1.5, null]);
    // 曲の頭が小節頭とほぼ同じ（0.1拍のずれ）なら弱起なし
    const t = normalize({ ...s, firstDownbeat: 0.05 });
    expect(pickupBeats(t, t.sections[0])).toBeNull();
    // 最初の小節頭を2小節あとに置いても、曲の頭のあとの最初の小節頭までの拍を数える
    const u = normalize({ ...s, firstDownbeat: 4.75 });
    expect([u.sections[0].barsEst, pickupBeats(u, u.sections[0])]).toEqual([4, 1.5]);
  });

  it('最初の小節頭を直すと、小節の線に乗っていた区切りも同じ拍数だけ動く', () => {
    // 120BPM・4/4。解析が小節頭を2拍早く取り違え（0.0秒。本当は 1.0秒）、区切りも 8秒・24秒（本当は 9秒・25秒）
    const s = normalize({ ...emptySong(40), bpmEst: 120, firstDownbeat: 0, sections: [newSection(0, 8), newSection(8, 24), newSection(24, 30.5), newSection(30.5, 40)] });
    const t = setTempo(s, { firstDownbeat: 1 });
    // 小節の線に乗っていない区切り（30.5秒）は動かさない。曲の頭も動かさない
    expect(t.sections.map((x) => x.start)).toEqual([0, 9, 25, 30.5]);
    expect(t.sections.map((x) => x.edited)).toEqual([false, true, true, false]);
    // 小節頭を2拍前へ直したときは、区切りも前へ動く。1小節ちょうど動かしたときは区切りは動かない
    expect(setTempo(s, { firstDownbeat: -1 }).sections.map((x) => x.start)).toEqual([0, 7, 23, 30.5]);
    expect(setTempo(s, { firstDownbeat: 2 }).sections.map((x) => x.start)).toEqual([0, 8, 24, 30.5]);
    // BPM と一緒に変えたとき（タップ）は区切りを動かさない
    expect(setTempo(s, { bpmManual: 121, firstDownbeat: 1 }).sections.map((x) => x.start)).toEqual([0, 8, 24, 30.5]);
  });

  it('前の拍を手で直すと、小節の線を動かさずに、最初の音より前の無音の中で曲の頭を動かす（音源ファイル・YouTube のずれも同じだけ動かす）', () => {
    // 曲の頭が本当より半拍早く、前の拍が2拍に見えている（音源ファイルの 2.0秒が曲の頭、最初の音は 2.3秒、最初の小節頭は 3.0秒）
    const analysis = { duration: 40, bpm: 120, firstDownbeat: 3, beatsUncertain: false, segments: [{ start: 0, end: 40, group: 'A' }], leadingSilence: 2.25, trailingSilence: 0 };
    const s = normalize({ ...emptySong(25), bpmEst: 120, firstDownbeat: 1, audio: { offset: 2, duration: 40 }, analysis, youtube: 'abcdefghijk', youtubeOffset: 1, sections: [newSection(0, 9), newSection(9, 25)] });
    expect(pickupBeats(s, s.sections[0])).toBe(2);
    // 1拍・0拍は曲の頭が最初の音より後ろになる（曲をカットする）ので選べない
    expect(pickupChoices(s)).toEqual([1.5, 2, 2.5, 3, 3.5]);
    expect(setPickup(s, 1)).toBe(s);
    const t = setPickup(s, 1.5);
    // 曲の頭は、拍の位置（音源ファイルの 2.25秒）より 0.05秒前
    expect([t.audio!.offset, t.youtubeOffset, t.firstDownbeat]).toEqual([2.2, 1.2, 0.8]);
    expect(t.sections.map((x) => [x.start, x.end])).toEqual([[0, 8.8], [8.8, 24.8]]);
    expect(setPickup(t, 1.5)).toBe(t);
    expect([pickupBeats(t, t.sections[0]), t.sections[0].barsEst]).toEqual([1.5, 4]);
    // 最初の小節頭は音源ファイルの上で同じ位置（3.0秒）
    expect(t.audio!.offset + t.firstDownbeat!).toBe(3);
    invariant(t);
    // 前の拍を増やすと曲の頭が前へ動く。音源ファイルの頭より前になるときは何もしない
    expect(setPickup(s, 3.5).audio!.offset).toBe(1.2);
    const early = normalize({ ...s, audio: { offset: 0.1, duration: 40 } });
    expect(setPickup(early, 3)).toBe(early);
  });

  it('推定小節数と自動の名前を付ける', () => {
    const s = sample();
    expect(s.sections.map((x) => x.barsEst)).toEqual([8, 16, 8, 16]);
    expect(s.sections.map((x) => x.name)).toEqual(['パートA', 'パートB（1回目）', 'パートC', 'パートB（2回目）']);
    invariant(s);
  });

  it('時刻を含む区間を探す（境界は後ろの区間に含める）', () => {
    const s = sample();
    expect(sectionAt(s, 0)?.id).toBe(s.sections[0].id);
    expect(sectionAt(s, 16)?.id).toBe(s.sections[1].id);
    expect(sectionAt(s, 95.9)?.id).toBe(s.sections[3].id);
    expect(sectionAt(s, 96)).toBeUndefined();
  });

  it('メトロノームを鳴らす拍の位置（小節の頭は小節の線と同じ）', () => {
    const s = sample();
    const clicks = beatClicks(s)!;
    expect(clicks.slice(0, 5)).toEqual([
      { t: 0, head: true }, { t: 0.5, head: false }, { t: 1, head: false }, { t: 1.5, head: false }, { t: 2, head: true },
    ]);
    expect(clicks.filter((b) => b.head).map((b) => b.t)).toEqual(barLines(s)!.filter((t) => t >= 0));
    expect(beatClicks(emptySong(10))).toBeNull();
  });

  it('曲全体を1つの区間にする', () => {
    const s = wholeSong(emptySong(), 30);
    expect(s.sections.map((x) => [x.start, x.end])).toEqual([[0, 30]]);
    expect(s.audio).toBeUndefined();
    expect(wholeSong(emptySong(), 30, true).audio).toEqual({ offset: 0, duration: 30 });
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
    expect(s.sections[2]).toMatchObject({ start: 32, end: 48, group: null, name: 'パート' });
    invariant(s);
  });

  it('分割した後半は、前半に付けた名前を引き継ぐ（仮の名前「パートB」などは引き継がない）', () => {
    let s = sample(); // A, B, C, B
    s = patchSection(s, s.sections[1].id, { name: 'サビ' }); // 繰り返し B の名前になる
    s = splitAt(s, 32);
    expect(s.sections.slice(1, 3).map((x) => x.name)).toEqual(['サビ', 'サビ']);
    expect(s.sections[2]).toMatchObject({ nameAuto: false, group: null });
    // 繰り返しの名前で付いている「サビ（2回目）」は、回数を除いた名前にする
    expect(s.sections[4].name).toBe('サビ（2回目）');
    s = splitAt(s, 80);
    expect(s.sections.slice(4, 6).map((x) => x.name)).toEqual(['サビ（2回目）', 'サビ']);
    // 仮の名前は引き継がない
    s = splitAt(s, 8);
    expect(s.sections.slice(0, 2).map((x) => x.name)).toEqual(['パートA', 'パート']);
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

  it('分割した片方の小節数を入れると、もう片方は残りの小節数になる', () => {
    let s = splitAt(sample(), 30); // 区間B（16小節）を 16〜30秒・30〜48秒 に分割
    const [first, second] = [s.sections[1], s.sections[2]];
    s = patchSection(s, first.id, { barsManual: 6 });
    expect(s.sections[2]).toMatchObject({ id: second.id, barsManual: 10 });
    s = patchSection(s, second.id, { barsManual: 12 });
    expect(s.sections[1].barsManual).toBe(4);
    // 合計を超える値や、入力を消したときは相手を変えない
    s = patchSection(s, first.id, { barsManual: 20 });
    expect(s.sections[2].barsManual).toBe(12);
    s = patchSection(s, first.id, { barsManual: null });
    expect(s.sections[2].barsManual).toBe(12);
  });

  it('分割前の手動小節数を元にする。外側の境界が動いたら連動しない', () => {
    let s = sample();
    s = patchSection(s, s.sections[1].id, { barsManual: 18 });
    s = splitAt(s, 32);
    s = patchSection(s, s.sections[1].id, { barsManual: 10 });
    expect(s.sections[2].barsManual).toBe(8);
    s = moveBoundary(s, 1, 14); // 前半の開始位置（外側の境界）を動かす
    s = patchSection(s, s.sections[1].id, { barsManual: 9 });
    expect(s.sections[2].barsManual).toBe(8);
  });

  it('分割した2区間の間の境界を動かしても連動は続く', () => {
    let s = splitAt(sample(), 32);
    s = moveBoundary(s, 2, 36);
    s = patchSection(s, s.sections[2].id, { barsManual: 5 });
    expect(s.sections[1].barsManual).toBe(11);
  });

  it('区間が1つのときは削除しない', () => {
    const s = normalize({ ...emptySong(10), sections: [newSection(0, 10)] });
    expect(deleteSection(s, s.sections[0].id)).toBe(s);
  });

  it('繰り返しの付け替えで自動の名前は変わり、利用者が付けた名前は残る', () => {
    let s = sample();
    s = setGroup(s, s.sections[2].id, 'B');
    expect(s.sections[2]).toMatchObject({ group: 'B', name: 'パートB（2回目）', groupManual: true });
    s = patchSection(s, s.sections[3].id, { name: 'サビ' });
    s = setGroup(s, s.sections[3].id, 'new');
    expect(s.sections[3]).toMatchObject({ group: 'C', name: 'サビ' });
    s = setGroup(s, s.sections[0].id, null);
    expect(s.sections[0]).toMatchObject({ group: null, name: 'パート' });
  });

  it('繰り返しの1回目に名前を付けると、同じ繰り返しの名前未設定の区間にも使われる', () => {
    let s = sample(); // A, B, C, B
    s = patchSection(s, s.sections[1].id, { name: 'サビ' });
    expect(s.sections.map((x) => x.name)).toEqual(['パートA', 'サビ', 'パートC', 'サビ（2回目）']);
    s = patchSection(s, s.sections[3].id, { name: '大サビ' }); // 2回目以降の名前はその区間だけ
    expect(s.sections.map((x) => x.name)).toEqual(['パートA', 'サビ', 'パートC', '大サビ']);
    s = setGroup(s, s.sections[2].id, 'B'); // 名前未設定の区間を同じ繰り返しにすると、1回目の名前になる
    expect(s.sections[2].name).toBe('サビ（2回目）');
    expect(validateSong(s)).toBeNull();
  });

  it('テンポを手動で変えると推定小節数が再計算され、手動小節数は残る', () => {
    let s = sample();
    s = patchSection(s, s.sections[1].id, { barsManual: 17 });
    s = setTempo(s, { bpmManual: 60 });
    expect(s.sections.map((x) => x.barsEst)).toEqual([4, 8, 4, 8]);
    expect(s.sections[1].barsManual).toBe(17);
  });

  it('小節の頭へのスナップと、区間の先頭から n 小節の位置', () => {
    const s = normalize({ ...sample(), firstDownbeat: 0.5 }); // 1小節2秒、小節の頭は 0.5, 2.5, 4.5 …（区切りは小節の線に乗せない）
    expect(snapToBar(s, 17.2)).toBeCloseTo(16.5);
    expect(barPositionIn(s, s.sections[1], 4)).toBeCloseTo(24); // 区間B（16秒〜）の始まりから4小節
    const t = barPositionIn(s, s.sections[1], 4)!;
    expect(splitAt(s, t).sections.slice(1, 3).map((x) => x.barsEst)).toEqual([4, 12]);
    expect(barPositionIn({ ...s, bpmEst: null }, s.sections[1], 4)).toBeNull();
  });

  it('解析で見つけた拍に沿って小節を数える（テンポが揺れても正しく数える）', () => {
    // だんだん速くなる曲：1拍 0.5秒 → 0.4秒。1小節目の頭は 1秒
    const beats: number[] = [];
    for (let t = 1, i = 0; i < 160; i++) { beats.push(t); t += 0.5 - (0.1 * i) / 160; }
    const at = (bar: number) => beats[bar * 4];
    let s = normalize({ ...emptySong(beats[159] + 0.5), bpmEst: 130, beats, firstDownbeat: 1,
      sections: [newSection(0, at(8)), newSection(at(8), at(24)), newSection(at(24), at(32)), newSection(at(32), beats[159] + 0.5)] });
    expect(usesDetectedBeats(s)).toBe(true);
    expect(s.sections.slice(1, 3).map((x) => x.barsEst)).toEqual([16, 8]);
    expect(snapToBar(s, at(20) + 0.3)).toBeCloseTo(at(20));
    expect(barPositionIn(s, s.sections[1], 5)).toBeCloseTo(at(13));
    // 等間隔で数えると後半ほどずれる（比較のため、手入力の BPM で拍の列を使わない場合）
    const uniform = setTempo(s, { bpmManual: 100 });
    expect(usesDetectedBeats(uniform)).toBe(false);
    expect(uniform.sections[2].barsEst).not.toBe(8);
  });

  it('途中に2拍だけの小節があっても、区間ごとに小節を数えるので後ろの区間がずれない', () => {
    // 120BPM（1拍0.5秒）。0〜16秒が8小節、16〜17秒が2拍だけの小節、17〜33秒が8小節
    const beats = Array.from({ length: 70 }, (_, i) => i * 0.5);
    let s = normalize({ ...emptySong(35), bpmEst: 120, beats, firstDownbeat: 0,
      sections: [newSection(0, 16), newSection(16, 17), newSection(17, 33), newSection(33, 35)] });
    expect(s.sections.map((x) => x.barsEst)).toEqual([8, 1, 8, 1]);
    // 3つ目の区間の「先頭から4小節」は 17 + 8 = 25秒（通しで数えた小節の線 24・26 ではない）
    expect(barPositionIn(s, s.sections[2], 4)).toBeCloseTo(25);
    // その区間の始まりから数えて、近い小節の頭に吸着する
    expect(snapToBar(s, 24.6, s.sections[2].start)).toBeCloseTo(25);
    expect(snapToBar(s, 24.6)).toBeCloseTo(24); // 通しの線（anchor なし）
    // 最初の小節頭がずれていても、区間の小節数は変わらない
    s = setTempo(s, { firstDownbeat: 1 });
    expect(s.sections.map((x) => x.barsEst)).toEqual([8, 1, 8, 1]);
  });

  it('小節数を手で推定と違う数に直した区間は、その小節数で等分した拍・小節の線にする（途中でテンポが変わる曲）', () => {
    // 曲は 120BPM（1小節2秒）。0〜24秒のイントロだけ 160BPM（1小節1.5秒）で、16小節ある
    const beats = Array.from({ length: 120 }, (_, i) => i * 0.5);
    let s = normalize({ ...emptySong(56), bpmEst: 120, beats, firstDownbeat: 0, sections: [newSection(0, 24), newSection(24, 56)] });
    expect(s.sections.map((x) => x.barsEst)).toEqual([12, 16]);
    s = patchSection(s, s.sections[0].id, { barsManual: 16 });
    expect(sectionBpm(s, s.sections[0])).toBe(160);
    expect(sectionBpm(s, s.sections[1])).toBeNull();
    const lines = barLines(s)!;
    expect(lines.filter((t) => t >= 0 && t < 24)).toHaveLength(16);
    expect(lines.filter((t) => t >= 24 && t < 56)).toHaveLength(16);
    expect(beatClicks(s)!.filter((b) => b.t < 24 - 0.05).map((b) => b.t).slice(0, 3)).toEqual([0, 0.375, 0.75]);
    expect(barPositionIn(s, s.sections[0], 4)).toBeCloseTo(6);
    expect(snapToBar(s, 6.4, 0)).toBeCloseTo(6);
    expect(s.sections[0].barsEst).toBe(12); // 推定は曲の拍のまま
    // 分けても、手の小節数を分けてそれぞれのテンポを保つ
    const split = splitAt(s, 6);
    expect(split.sections.slice(0, 2).map((x) => x.barsManual)).toEqual([4, 12]);
    expect(split.sections.slice(0, 2).map((x) => sectionBpm(split, x))).toEqual([160, 160]);
    // 推定と同じ数を入れたときは、今までどおり曲の拍を使う
    const same = patchSection(s, s.sections[0].id, { barsManual: 12 });
    expect(sectionBpm(same, same.sections[0])).toBeNull();
  });

  it('区間名の候補：イントロ・Aメロ・Bメロ・サビ・間奏・アウトロ', () => {
    // イントロ / A B サビ / A B サビ / 間奏 / サビ / アウトロ。サビは音量が大きい
    const plan: [string | null, number, number][] = [
      ['X', 8, -22], ['A', 16, -20], ['B', 8, -19], ['C', 16, -15], ['A', 16, -20], ['B', 8, -19], ['C', 16, -15],
      ['Y', 8, -21], ['C', 16, -15], ['Z', 8, -23]];
    let t = 0;
    const sections = plan.map(([g, bars, e]) => { const s = newSection(t, t + bars * 2, { group: g, energy: e }); t += bars * 2; return s; });
    const song = normalize({ ...emptySong(t), bpmEst: 120, firstDownbeat: 0, sections });
    const names = suggestNames(song);
    expect(song.sections.map((s) => names[s.id])).toEqual(['イントロ', 'Aメロ', 'Bメロ', 'サビ', 'Aメロ', 'Bメロ', 'サビ', '間奏', 'サビ', 'アウトロ']);
    const applied = applySuggestedNames(song);
    expect(applied.sections.map((s) => s.name)).toEqual(['イントロ', 'Aメロ', 'Bメロ', 'サビ', 'Aメロ（2回目）', 'Bメロ（2回目）', 'サビ（2回目）', '間奏', 'サビ（3回目）', 'アウトロ']);
  });

  it('自分で付けた名前は、名前の候補で上書きしない', () => {
    let t = 0;
    const sections = [['A', -20], ['C', -15], ['A', -20], ['C', -15]].map(([g, e]) => { const s = newSection(t, t + 16, { group: g as string, energy: e as number }); t += 16; return s; });
    let song = normalize({ ...emptySong(t), bpmEst: 120, firstDownbeat: 0, sections });
    song = patchSection(song, song.sections[1].id, { name: '大サビ' });
    expect(applySuggestedNames(song).sections[1].name).toBe('大サビ');
  });

  it('ネット上の BPM で倍・半分の取り違えを判定する', () => {
    expect(octaveByReference(74.4, 138)).toBe(2); // ゲット・アップ・ルーシー：推定は半分。ネットの値とは8%ずれるが倍率は分かる
    expect(octaveByReference(148.8, 138)).toBe(1);
    expect(octaveByReference(163, 81)).toBe(0.5);
    expect(octaveByReference(120, 90)).toBeNull(); // 倍でも半分でもない（別の曲・3拍子など）
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

  it('自動解析の結果に戻す：手動修正を捨て、曲名とメモは残す', () => {
    const r = { version: 't', duration: 64, bpm: 120, beats: [], firstDownbeat: 0.5, beatsUncertain: false,
      segments: [{ start: 0, end: 32, group: 'A' }, { start: 32, end: 64, group: 'B' }] };
    let s = songFromAnalysis(r);
    s = { ...s, title: '曲', memo: '全体メモ' };
    s = splitAt(s, 16);
    s = patchSection(s, s.sections[0].id, { name: 'イントロ', barsManual: 9 });
    s = setTempo(s, { bpmManual: 60, firstDownbeat: 1 });
    const back = resetToAnalysis(s);
    expect(back.sections.map((x) => [x.start, x.end, x.name, x.barsManual, x.edited])).toEqual([[0, 32, 'パートA', null, false], [32, 64, 'パートB', null, false]]);
    expect(back).toMatchObject({ title: '曲', memo: '全体メモ', bpmManual: null, firstDownbeat: 0.5, firstDownbeatManual: false });
    expect(validateSong(back)).toBeNull();
  });

  it('手動修正があっても、解析結果で作り直せる', () => {
    let s = sample();
    s = { ...s, title: '曲' };
    s = patchSection(s, s.sections[0].id, { name: 'イントロ', barsManual: 3 });
    const r = { version: 't2', duration: 96, bpm: 121, beats: [0.5, 1], firstDownbeat: 0.5, beatsUncertain: false,
      segments: [{ start: 0, end: 48, group: 'A' }, { start: 48, end: 96, group: 'A' }] };
    const out = regenerateFromAnalysis(s, r);
    expect(out.sections.map((x) => [x.start, x.end, x.name, x.edited])).toEqual([[0, 48, 'パートA（1回目）', false], [48, 96, 'パートA（2回目）', false]]);
    expect(out).toMatchObject({ title: '曲', bpmEst: 121, bpmManual: null, analysisVersion: 't2', beats: [0.5, 1] });
    expect(resetToAnalysis(out).sections).toHaveLength(2); // 作り直した結果が「戻す」先になる
    expect(validateSong(out)).toBeNull();
  });

  it('曲頭の無音は構成に入れず、曲の頭を 0:00 にして音源ファイルのずれにする。戻すときも同じ', () => {
    const r = { version: 't', duration: 66, bpm: 120, beats: [2, 2.5, 3], firstDownbeat: 2, beatsUncertain: false, leadingSilence: 2,
      segments: [{ start: 0, end: 34, group: 'A' }, { start: 34, end: 66, group: 'B' }] };
    const s = songFromAnalysis(r);
    expect(s.sections.map((x) => [x.start, x.end, x.name, x.barsEst, !!x.silence])).toEqual([[0, 32, 'パートA', 16, false], [32, 64, 'パートB', 16, false]]);
    expect(s).toMatchObject({ duration: 64, firstDownbeat: 0, beats: [0, 0.5, 1], audio: { offset: 2, duration: 66 } });
    expect(validateSong(s)).toBeNull();
    const edited = patchSection(s, s.sections[0].id, { name: 'イントロ' });
    const back = resetToAnalysis(edited);
    expect(back.sections.map((x) => [x.start, x.end, x.name])).toEqual([[0, 32, 'パートA'], [32, 64, 'パートB']]);
    expect(back).toMatchObject({ firstDownbeat: 0, beats: [0, 0.5, 1], audio: { offset: 2, duration: 66 } });
  });

  it('曲末の無音も構成に入れない', () => {
    const r = { version: 't', duration: 70, bpm: 120, beats: [], firstDownbeat: 2, beatsUncertain: false, leadingSilence: 2, trailingSilence: 4,
      segments: [{ start: 0, end: 34, group: 'A' }, { start: 34, end: 70, group: 'B' }] };
    const s = songFromAnalysis(r);
    expect(s.sections.map((x) => [x.start, x.end, x.name, x.barsEst])).toEqual([[0, 32, 'パートA', 16], [32, 64, 'パートB', 16]]);
    expect(s).toMatchObject({ duration: 64, audio: { offset: 2, duration: 70 } });
    expect(validateSong(s)).toBeNull();
  });

  it('作り直して曲の頭（音源ファイルのずれ）が変わっても、YouTube の再生位置を保つ', () => {
    const r = (lead: number) => ({ version: 't', duration: 70, bpm: 120, beats: [lead, lead + 0.5], firstDownbeat: lead, beatsUncertain: false, leadingSilence: lead,
      segments: [{ start: 0, end: 34, group: 'A' }, { start: 34, end: 70, group: 'B' }] });
    const s = { ...songFromAnalysis(r(2)), youtube: 'M7lc1UVf-VE', youtubeOffset: 5 };
    // 曲の頭が音源ファイルの 2秒目 → 3秒目 に動くと、同じ音の位置の曲の時刻は1秒早くなる。動画のずれは1秒増やす
    const again = regenerateFromAnalysis(s, r(3));
    expect(again).toMatchObject({ audio: { offset: 3, duration: 70 }, youtubeOffset: 6, firstDownbeat: 0, beats: [0, 0.5] });
    expect(songFromAnalysis(r(3), s)).toMatchObject({ audio: { offset: 3 }, youtubeOffset: 6, beats: [0, 0.5] });
    // 区間を手で直していれば区間は残し、拍だけ今のずれで曲の時刻に直す
    const kept = adoptAnalysis(patchSection(s, s.sections[0].id, { name: 'イントロ' }), r(2)).song;
    expect(kept).toMatchObject({ audio: { offset: 2 }, youtubeOffset: 5, beats: [0, 0.5], firstDownbeat: 0 });
  });

  it('以前の形式（無音の区間）を、曲の頭を 0:00 にした形に直す', () => {
    const old = normalize({
      ...emptySong(70), bpmEst: 120, firstDownbeat: 2, beats: [2, 2.5], memo: 'キーは E', youtube: 'M7lc1UVf-VE', youtubeOffset: 8,
      sections: [
        newSection(0, 2, { name: '無音（曲の前）', nameAuto: false, silence: true, memo: 'カウント4つ' }),
        newSection(2, 34, { group: 'A' }), newSection(34, 66, { group: 'B' }),
        newSection(66, 70, { name: '無音（曲の後）', nameAuto: false, silence: true }),
      ],
    });
    const s = trimSilence(old);
    expect(s.sections.map((x) => [x.start, x.end, x.barsEst, !!x.silence])).toEqual([[0, 32, 16, false], [32, 64, 16, false]]);
    expect(s).toMatchObject({ duration: 64, firstDownbeat: 0, beats: [0, 0.5], audio: { offset: 2, duration: 70 }, youtubeOffset: 10, memo: 'キーは E\n無音（曲の前）：カウント4つ' });
    expect(validateSong(s)).toBeNull();
    expect(trimSilence(s)).toBe(s); // 直したものはそのまま
    // 形式を直しただけでは、閲覧ページに「変更あり」と出さない
    expect(diffSongs(old, s).changed).toBe(false);
  });

  it('自動解析の結果がなければ戻さない', () => {
    const s = sample();
    expect(resetToAnalysis(s)).toBe(s);
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

  it('分割・結合・名前・繰り返し・小節数・メモの変更を区間ごとに示す', () => {
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

describe('YouTube の動画', () => {
  it('いろいろな URL から動画 ID を取り出す', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      id,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?list=PL1&v=${id}&t=30s`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}&si=abc`,
      `https://youtu.be/${id}?si=abc`,
      `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
    ]) expect(youtubeId(url)).toBe(id);
  });

  it('YouTube 以外や読めない URL は null', () => {
    for (const url of ['', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/@channel', 'あいう'])
      expect(youtubeId(url)).toBeNull();
  });

  it('保存できる値と差分', () => {
    const prev = sample();
    expect(validateSong({ ...prev, youtube: 'dQw4w9WgXcQ' })).toBeNull();
    expect(validateSong({ ...prev, youtube: '<script>' })).not.toBeNull();
    expect(diffSongs(prev, { ...prev, youtube: 'dQw4w9WgXcQ' }).song).toContain('YouTube の動画');
    expect(diffSongs(prev, { ...prev, youtube: null }).changed).toBe(false);
    expect(validateSong({ ...prev, youtube: 'dQw4w9WgXcQ', youtubeOffset: -12.34 })).toBeNull();
    expect(validateSong({ ...prev, youtubeOffset: 9999 })).not.toBeNull();
    expect(validateSong({ ...prev, youtubeOffset: Number.NaN })).not.toBeNull();
    expect(diffSongs({ ...prev, youtube: 'dQw4w9WgXcQ' }, { ...prev, youtube: 'dQw4w9WgXcQ', youtubeOffset: 3 }).song).toContain('YouTube の動画');
    expect(clampOffset(1.23456)).toBe(1.23);
    expect(clampOffset(-1000)).toBe(-600);
  });
});

describe('タップで BPM を求める', () => {
  const beat = 60 / 99.9;
  const exact = (n: number, from = 10) => Array.from({ length: n }, (_, i) => from + i * beat);

  it('押した時刻のばらつきをならして BPM と最初の拍を求める', () => {
    const jitter = [0.02, -0.03, 0.01, 0.025, -0.015, 0, -0.02, 0.03];
    const r = tapTempo(exact(8).map((t, i) => t + jitter[i]))!;
    expect(Math.abs(r.bpm - 99.9)).toBeLessThan(1);
    expect(Math.abs(r.first - (10 - TAP_LATENCY))).toBeLessThan(0.03);
  });

  it('1拍押し損ねても2拍分として数える', () => {
    const taps = exact(8);
    taps.splice(4, 1);
    expect(tapTempo(taps)!.bpm).toBeCloseTo(99.9, 1);
  });

  it('押した回数が少ない・時刻が戻ったときは求めない', () => {
    expect(tapTempo(exact(3))).toBeNull();
    expect(tapTempo([1, 2, 1.5, 3])).toBeNull();
  });
});

describe('区間名の候補：イントロの素材', () => {
  it('最初のパートはサビでなければイントロにし、同じ素材は間奏・アウトロにする', () => {
    // イントロの素材 X が、曲の途中（間奏）と最後（アウトロ）にも出てくる
    const plan: [string, number, number][] = [
      ['X', 8, -22], ['A', 16, -20], ['C', 16, -15], ['X', 8, -22], ['A', 16, -20], ['C', 16, -15], ['X', 8, -22]];
    let t = 0;
    const sections = plan.map(([g, bars, e]) => { const s = newSection(t, t + bars * 2, { group: g, energy: e }); t += bars * 2; return s; });
    const song = normalize({ ...emptySong(t), bpmEst: 120, firstDownbeat: 0, sections });
    const names = suggestNames(song);
    expect(song.sections.map((s) => names[s.id])).toEqual(['イントロ', 'Aメロ', 'サビ', '間奏', 'Aメロ', 'サビ', 'アウトロ']);
    expect(applySuggestedNames(song).sections.map((s) => s.name)).toEqual(['イントロ', 'Aメロ', 'サビ', '間奏', 'Aメロ（2回目）', 'サビ（2回目）', 'アウトロ']);
  });

  it('曲の頭の音が小さいパート・短いパートはイントロ前にし、その次をイントロにする', () => {
    // P：音の小さい4小節（イントロ前）、F：2小節のフィル。イントロ前の素材 P が最後にも出てくればアウトロにする
    const plan: [string, number, number][] = [
      ['P', 4, -30], ['F', 2, -19], ['X', 8, -19], ['A', 16, -20], ['C', 16, -15], ['A', 16, -20], ['C', 16, -15], ['P', 4, -30]];
    let t = 0;
    const sections = plan.map(([g, bars, e]) => { const s = newSection(t, t + bars * 2, { group: g, energy: e }); t += bars * 2; return s; });
    const song = normalize({ ...emptySong(t), bpmEst: 120, firstDownbeat: 0, sections });
    const names = suggestNames(song);
    expect(song.sections.map((s) => names[s.id])).toEqual(['イントロ前', 'イントロ前', 'イントロ', 'Aメロ', 'サビ', 'Aメロ', 'サビ', 'アウトロ']);
  });

  it('歌の割合があれば、歌のない回をサビ・Aメロにせず、歌のある1回だけの区間を Aメロ・Cメロにする', () => {
    // サビの伴奏だけが鳴る間奏（C の2回目・歌なし）と、2回目のサビの後に1回だけ出てくる歌（N）がある
    const plan: [string, number, number, number][] = [
      ['X', 8, -22, 0], ['A', 16, -20, 0.2], ['C', 16, -15, 0.3], ['C', 16, -15, 0.01], ['A', 16, -20, 0.2], ['C', 16, -15, 0.3],
      ['N', 8, -18, 0.25], ['C', 16, -15, 0.3], ['Z', 8, -23, 0]];
    let t = 0;
    const sections = plan.map(([g, bars, e, v]) => { const s = newSection(t, t + bars * 2, { group: g, energy: e, vocal: v }); t += bars * 2; return s; });
    const song = normalize({ ...emptySong(t), bpmEst: 120, firstDownbeat: 0, sections });
    const names = suggestNames(song);
    expect(song.sections.map((s) => names[s.id])).toEqual(['イントロ', 'Aメロ', 'サビ', '間奏', 'Aメロ', 'サビ', 'Cメロ', 'サビ', 'アウトロ']);
    // 歌の割合がなければ（以前の解析）、今までどおり繰り返しで決める
    const old = normalize({ ...song, sections: song.sections.map(({ vocal: _, ...s }) => s) });
    expect(suggestNames(old)[old.sections[3].id]).toBe('サビ');
  });

  it('いつもサビの直後にだけ出てくる短いパートは、サビの続きにする', () => {
    // サビが C（12小節）＋ T（4小節）に分かれている。T を Aメロ・Bメロの候補にしない
    const plan: [string, number, number][] = [
      ['X', 8, -22], ['A', 16, -20], ['C', 12, -15], ['T', 4, -17], ['A', 16, -20], ['C', 12, -15], ['T', 4, -17], ['Y', 8, -21]];
    let t = 0;
    const sections = plan.map(([g, bars, e]) => { const s = newSection(t, t + bars * 2, { group: g, energy: e }); t += bars * 2; return s; });
    const song = normalize({ ...emptySong(t), bpmEst: 120, firstDownbeat: 0, sections });
    const names = suggestNames(song);
    expect(song.sections.map((s) => names[s.id])).toEqual(['イントロ', 'Aメロ', 'サビ', 'サビ', 'Aメロ', 'サビ', 'サビ', 'アウトロ']);
  });
});

describe('コード進行', () => {
  // 120BPM・4/4（1小節2秒）。最初の区間（0〜16秒・8小節）だけを見る
  const withChords = (): Song => ({ ...sample(), chords: [{ t: 0, chord: 'Am' }, { t: 3, chord: 'G' }, { t: 4, chord: 'F' }, { t: 6, chord: 'N' }] });

  it('推定のコードを小節ごとに1行にする（前半と後半で違えば2つ）', () => {
    const s = withChords();
    expect(estimatedChords(s, s.sections[0])).toBe('| Am | Am G | F | - | - | - | - | - |');
  });

  it('解析の結果からコードだけを反映し、区間・手入力のコードはそのまま', () => {
    let s: Song = { ...sample(), audio: { offset: 1.5, duration: 97.5 } };
    s = patchSection(s, s.sections[0].id, { name: 'イントロ', chords: '| C |' });
    const next = adoptChords(s, {
      version: 'x', duration: 97.5, bpm: 90, beats: [], firstDownbeat: null, beatsUncertain: true, segments: [{ start: 0, end: 97.5, group: 'A' }],
      chords: [{ t: 1.5, chord: 'Am' }, { t: 5.5, chord: 'G' }],
    });
    // 音源ファイルの時刻から、曲の頭（1.5秒目）を 0:00 とする時刻に直す
    expect(next.chords).toEqual([{ t: 0, chord: 'Am' }, { t: 4, chord: 'G' }]);
    expect(next.sections).toBe(s.sections);
    expect(next.bpmEst).toBe(120);
    expect(sectionChords(next, next.sections[0])).toEqual({ text: '| C |', source: 'manual' });
  });

  it('閲覧ページ・書き出しには手で入れたものだけを出し、1回目と違う繰り返しに気づけるようにする', () => {
    let s = withChords();
    expect(confirmedChords(s, s.sections[0])).toBeNull(); // 推定だけ
    s = patchSection(s, s.sections[1].id, { chords: '| C | G | Am | F |' });
    expect(confirmedChords(s, s.sections[3])).toEqual({ text: '| C | G | Am | F |', source: 'repeat' });
    expect(chordsDifferFromFirst(s, s.sections[3])).toBe(false);
    s = patchSection(s, s.sections[3].id, { chords: '| C | G | Am | E7 |' });
    expect(chordsDifferFromFirst(s, s.sections[3])).toBe(true);
    expect(chordsDifferFromFirst(s, s.sections[1])).toBe(false);
  });

  it('手で入れたコードを優先し、繰り返しの2回目以降は1回目を引き継ぐ', () => {
    let s = withChords();
    // sample() の区間：A / B / C / B。B の1回目に入れると、2回目にも使う
    s = patchSection(s, s.sections[1].id, { chords: '| C | G | Am | F |' });
    expect(sectionChords(s, s.sections[1])).toEqual({ text: '| C | G | Am | F |', source: 'manual' });
    expect(sectionChords(s, s.sections[3])).toEqual({ text: '| C | G | Am | F |', source: 'repeat' });
    expect(sectionChords(s, s.sections[0])?.source).toBe('estimate');
    invariant(s);
  });
});

describe('閲覧ページの変更表示', () => {
  it('最初の小節頭だけの変更は曲全体の変更として知らせない', () => {
    const prev = sample();
    expect(diffSongs(prev, setTempo(prev, { firstDownbeat: 0.02 })).song).toEqual([]);
  });
});

describe('アーティスト名の照合', () => {
  it('表記ゆれは同じとみなし、空や別の人は違うとみなす', () => {
    expect(sameArtist('椎名林檎', '椎名 林檎')).toBe(true);
    expect(sameArtist('THEE MICHELLE GUN ELEPHANT', 'Thee Michelle Gun Elephant')).toBe(true);
    expect(sameArtist('UTADA HIKARU', '椎名林檎')).toBe(false);
    expect(sameArtist('椎名林檎', '')).toBe(false);
  });
});

describe('キーと移調', () => {
  it('キーとコード進行を移調し、シャープ・フラットはキーに合わせる', () => {
    expect(transposeKey('Eb', -2)).toBe('Db');
    expect(transposeKey('Am', 2)).toBe('Bm');
    expect(transposeKey('C', 1)).toBe('Db');
    expect(transposeKey('Cm', 6)).toBe('F#m');
    expect(transposeChords('| Abmaj7 | G7 | Cm7 | Bbm7 Eb7 |', -2, 'Db')).toBe('| Gbmaj7 | F7 | Bbm7 | Abm7 Db7 |');
    expect(transposeChords('| C | G/B | Am7 | F(onG) |', 2, 'D')).toBe('| D | A/C# | Bm7 | G(onA) |');
    expect(transposeChords('| - | N |', 3, 'C')).toBe('| - | N |');
    expect(keySummary({ ...emptySong(), originalKey: 'Eb', transpose: -2 })).toBe('原曲 E♭ → 演奏 D♭（-2）');
    expect(keySummary(emptySong())).toBeNull();
  });
});
