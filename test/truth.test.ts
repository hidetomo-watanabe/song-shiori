import { describe, expect, it } from 'vitest';
import { emptySong, newSection, normalize } from '../shared/song';
import { parseTruth, songToText } from '../shared/truth';

describe('構成表のテキスト', () => {
  it('検証音源フォルダの README の書き方を読める', () => {
    const t = parseTruth(`# 曲名
# BPM: 149
# 拍子: 4/4
0:00   無音
0:01.5 イントロ   # ギターから
0:05.2 Aメロ 16小節
1:00 サビ
# 長さ: 1:30`);
    expect(t.bpm).toBe(149);
    expect(t.beatsPerBar).toBe(4);
    expect(t.sections.map((s) => [s.start, s.end, s.name, s.bars])).toEqual([
      [0, 1.5, '無音', null], [1.5, 5.2, 'イントロ', null], [5.2, 60, 'Aメロ', 16], [60, 90, 'サビ', null]]);
  });

  it('書き出したテキストは読みやすく、読み戻すと区間・小節数・メモが一致する', () => {
    let t = 0;
    const sections = [8, 16, 8].map((bars, i) => {
      const s = newSection(t, t + bars * 2, { name: ['イントロ', 'Aメロ', 'サビ'][i], nameAuto: false, memo: i === 1 ? 'ドラムは抑えめ' : '' });
      t += bars * 2;
      return s;
    });
    sections.unshift(newSection(0, 0.5, { name: '無音（曲の前）', nameAuto: false, silence: true }));
    sections[1] = { ...sections[1], start: 0.5 };
    const song = normalize({ ...emptySong(t), title: '曲', artist: '歌手', bpmEst: 120, firstDownbeat: 0.5, sections, memo: 'キーは E' });
    const text = songToText(song);
    expect(text).toContain('曲 / 歌手\nBPM 120・4/4・長さ 1:04.0\n\n0:00.0 （無音）\n0:00.5 イントロ 8小節\n0:16.0 Aメロ 16小節 ｜ドラムは抑えめ\n0:48.0 サビ 8小節\n\nキーは E');
    expect(text).not.toContain('#');
    const back = parseTruth(text);
    expect(back.bpm).toBe(120);
    expect(back.duration).toBe(64);
    expect(back.sections.map((s) => [s.start, s.end, s.name, s.bars, s.memo])).toEqual([
      [0, 0.5, '無音', null, ''], [0.5, 16, 'イントロ', 8, ''], [16, 48, 'Aメロ', 16, 'ドラムは抑えめ'], [48, 64, 'サビ', 8, '']]);
    expect(back.youtube).toBeNull();
  });

  it('YouTube の動画とずれを書き出し、読み戻せる', () => {
    const song = normalize({ ...emptySong(20), title: '曲', bpmEst: 120, youtube: 'M7lc1UVf-VE', youtubeOffset: -3.5, sections: [newSection(0, 20, { name: 'イントロ', nameAuto: false })] });
    const text = songToText(song);
    expect(text).toContain('曲\nBPM 120・4/4・長さ 0:20.0\nYouTube https://youtu.be/M7lc1UVf-VE ずれ -3.50秒\n\n0:00.0 イントロ');
    const back = parseTruth(text);
    expect([back.youtube, back.youtubeOffset, back.bpm, back.beatsPerBar, back.title]).toEqual(['M7lc1UVf-VE', -3.5, 120, 4, '曲']);
    expect(songToText({ ...song, youtubeOffset: undefined })).toContain('YouTube https://youtu.be/M7lc1UVf-VE\n');
    // 手で書いた行（ほかの URL の形・全角のコロン・ずれなし）も読める
    expect(parseTruth('YouTube：https://www.youtube.com/watch?v=M7lc1UVf-VE&t=10s\n0:00 イントロ')).toMatchObject({ youtube: 'M7lc1UVf-VE', youtubeOffset: 0 });
  });
});

import { songFromText } from '../shared/importText';
import { validateSong } from '../shared/song';

describe('テキストから構成を作る', () => {
  const text = `ゲット・アップ・ルーシー / THEE MICHELLE GUN ELEPHANT
BPM 120・4/4・長さ 1:10.0

0:00.0 （無音）
0:02.0 イントロ 4小節
0:10.0 Aメロ 8小節 ｜ドラムは抑えめ
0:26.0 サビ 8小節
0:42.0 Aメロ（2回目） 8小節
0:58.0 サビ（2回目） 5小節
1:08.0 （無音）

キーは E`;

  it('曲名・BPM・区間・メモ・全体メモを読み込み、同じ名前の区間を同じ繰り返しにする', () => {
    const { song, warnings } = songFromText(text);
    expect(warnings).toEqual([]);
    expect(song).toMatchObject({ title: 'ゲット・アップ・ルーシー', artist: 'THEE MICHELLE GUN ELEPHANT', memo: 'キーは E', bpmManual: 120, beatsPerBar: 4, duration: 70 });
    expect(song.sections.map((s) => [s.start, s.end, s.name, s.group, s.silence ?? false, s.memo])).toEqual([
      [0, 2, '無音（曲の前）', null, true, ''], [2, 10, 'イントロ', null, false, ''], [10, 26, 'Aメロ', 'A', false, 'ドラムは抑えめ'],
      [26, 42, 'サビ', 'B', false, ''], [42, 58, 'Aメロ（2回目）', 'A', false, ''], [58, 68, 'サビ（2回目）', 'B', false, ''],
      [68, 70, '無音（曲の後）', null, true, '']]);
    // 拍から数えた小節数（5）と同じなら推定のまま、違えば手入力として残す
    expect(song.sections.map((s) => [s.barsEst, s.barsManual])).toEqual([[null, null], [4, null], [8, null], [8, null], [8, null], [5, null], [null, null]]);
    expect(validateSong(song)).toBeNull();
  });

  it('YouTube の動画とずれを読み込み、書かれていなければ今の動画のまま', () => {
    const withVideo = songFromText(text.replace('長さ 1:10.0\n', '長さ 1:10.0\nYouTube https://youtu.be/M7lc1UVf-VE ずれ +5.02秒\n')).song;
    expect([withVideo.youtube, withVideo.youtubeOffset]).toEqual(['M7lc1UVf-VE', 5.02]);
    expect(validateSong(withVideo)).toBeNull();
    const kept = songFromText(text, { ...emptySong(), youtube: 'dQw4w9WgXcQ', youtubeOffset: 1.5 }).song;
    expect([kept.youtube, kept.youtubeOffset]).toEqual(['dQw4w9WgXcQ', 1.5]);
  });

  it('音源の長さに合わせ、違えば知らせる', () => {
    const { song, warnings } = songFromText(text, undefined, 66);
    expect(song.duration).toBe(66);
    expect(song.sections[song.sections.length - 1]).toMatchObject({ start: 58, end: 66, name: 'サビ（2回目）' });
    expect(warnings[0]).toMatch(/長さ/);
  });

  it('区間がなければ読み込まない', () => {
    expect(songFromText('こんにちは').warnings[0]).toMatch(/区間が読み取れません/);
  });
});
