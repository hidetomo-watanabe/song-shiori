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

  it('書き出したテキストは読みやすく、読み戻すと区間・小節数・メモが一致する（以前の形式の無音は除き、曲の頭から）', () => {
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
    expect(text).toContain('曲 / 歌手\nBPM 120・4/4・長さ 1:03.5\n\n0:00.0 イントロ 8小節\n0:15.5 Aメロ 16小節 ｜ドラムは抑えめ\n0:47.5 サビ 8小節\n\nキーは E');
    expect(text).not.toContain('#');
    expect(text).not.toContain('無音');
    const back = parseTruth(text);
    expect(back.bpm).toBe(120);
    expect(back.duration).toBe(63.5);
    expect(back.sections.map((s) => [s.start, s.end, s.name, s.bars, s.memo])).toEqual([
      [0, 15.5, 'イントロ', 8, ''], [15.5, 47.5, 'Aメロ', 16, 'ドラムは抑えめ'], [47.5, 63.5, 'サビ', 8, '']]);
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
import { chordChartSite, chordChartUrl, validateSong } from '../shared/song';

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

  it('曲名・BPM・区間・メモ・全体メモを読み込み、同じ名前の区間を同じ繰り返しにする（以前の形式の無音は除き、曲の頭を 0:00 に）', () => {
    const { song, warnings } = songFromText(text);
    expect(warnings).toEqual([]);
    expect(song).toMatchObject({ title: 'ゲット・アップ・ルーシー', artist: 'THEE MICHELLE GUN ELEPHANT', memo: 'キーは E', bpmManual: 120, beatsPerBar: 4, duration: 66 });
    expect(song.sections.map((s) => [s.start, s.end, s.name, s.group, s.silence ?? false, s.memo])).toEqual([
      [0, 8, 'イントロ', null, false, ''], [8, 24, 'Aメロ', 'A', false, 'ドラムは抑えめ'],
      [24, 40, 'サビ', 'B', false, ''], [40, 56, 'Aメロ（2回目）', 'A', false, ''], [56, 66, 'サビ（2回目）', 'B', false, '']]);
    // 拍から数えた小節数（5）と同じなら推定のまま、違えば手入力として残す
    expect(song.sections.map((s) => [s.barsEst, s.barsManual])).toEqual([[4, null], [8, null], [8, null], [8, null], [5, null]]);
    // 曲頭の無音は音源ファイルのずれになる
    expect(song.audio).toEqual({ offset: 2, duration: 70 });
    expect(validateSong(song)).toBeNull();
  });

  it('今の形式（曲の頭が 0:00）のテキストはそのまま読み込む', () => {
    const { song } = songFromText('曲\nBPM 120・4/4・長さ 0:24.0\n\n0:00.0 イントロ 4小節\n0:08.0 Aメロ 8小節', { ...emptySong(), audio: { offset: 1.5, duration: 30 } });
    expect(song.sections.map((s) => [s.start, s.end, s.name])).toEqual([[0, 8, 'イントロ'], [8, 24, 'Aメロ']]);
    expect(song.audio).toEqual({ offset: 1.5, duration: 30 });
  });

  it('YouTube の動画とずれを読み込み、書かれていなければ今の動画のまま', () => {
    const withVideo = songFromText(text.replace('長さ 1:10.0\n', '長さ 1:10.0\nYouTube https://youtu.be/M7lc1UVf-VE ずれ +5.02秒\n')).song;
    // 以前の形式のテキストでは、曲頭の無音（2秒）の分だけ YouTube のずれも動かす
    expect([withVideo.youtube, withVideo.youtubeOffset]).toEqual(['M7lc1UVf-VE', 7.02]);
    expect(validateSong(withVideo)).toBeNull();
    const kept = songFromText(text, { ...emptySong(), youtube: 'dQw4w9WgXcQ', youtubeOffset: 1.5 }).song;
    expect([kept.youtube, kept.youtubeOffset]).toEqual(['dQw4w9WgXcQ', 1.5]);
  });

  it('音源の長さに合わせ、違えば知らせる', () => {
    const { song, warnings } = songFromText('曲\nBPM 120・4/4・長さ 1:06.0\n\n0:00.0 イントロ 4小節\n0:08.0 Aメロ 8小節\n0:24.0 サビ 8小節', undefined, 60);
    expect(song.duration).toBe(60);
    expect(song.sections[song.sections.length - 1]).toMatchObject({ start: 24, end: 60, name: 'サビ' });
    expect(warnings[0]).toMatch(/長さ/);
  });

  it('区間がなければ読み込まない', () => {
    expect(songFromText('こんにちは').warnings[0]).toMatch(/区間が読み取れません/);
  });
});

describe('コード進行のテキスト', () => {
  it('区間の次の「コード」の行を書き出し、読み込むと手で入れたコード進行になる', () => {
    const text = '曲 / 歌手\nBPM 120・4/4\n\n0:00.0 イントロ 4小節\n  コード | Am | G | F | E7 |\n0:08.0 サビ 4小節\n';
    const { song } = songFromText(text);
    expect(song.sections.map((s) => s.chords ?? null)).toEqual(['| Am | G | F | E7 |', null]);
    expect(songToText(song)).toContain('0:00.0 イントロ 4小節\n  コード | Am | G | F | E7 |\n0:08.0 サビ');
    // 推定のコードは書き出さない
    expect(songToText({ ...song, chords: [{ t: 0, chord: 'C' }] })).not.toMatch(/0:08\.0 サビ.*\n\s+コード/);
  });
});

describe('コード譜のページ', () => {
  it('https の URL だけを使い、テキストに書き出して読み込める', () => {
    expect(chordChartUrl(' https://www.ufret.jp/song.php?data=1057 ')).toBe('https://www.ufret.jp/song.php?data=1057');
    expect(chordChartUrl('http://www.ufret.jp/song.php?data=1057')).toBeNull();
    expect(chordChartUrl('javascript:alert(1)')).toBeNull();
    expect(chordChartSite('https://www.ufret.jp/song.php?data=1057')).toBe('U-FRET');
    const { song } = songFromText('曲 / 歌手\nBPM 120・4/4\nコード譜 https://www.ufret.jp/song.php?data=1057\n\n0:00.0 イントロ 4小節\n0:08.0 サビ 4小節\n');
    expect(song.chordChartUrl).toBe('https://www.ufret.jp/song.php?data=1057');
    expect(validateSong(song)).toBeNull();
    expect(songToText(song)).toContain('コード譜 https://www.ufret.jp/song.php?data=1057');
    expect(validateSong({ ...song, chordChartUrl: 'javascript:alert(1)' })).not.toBeNull();
  });
});

describe('原曲との違いとキーのテキスト', () => {
  it('カット・原曲と違う点・キーを書き出して読み込める', () => {
    const text = '曲 / 歌手\nBPM 120・4/4\nキー 原曲 Eb → -2\n\n0:00.0 イントロ 4小節\n  カット\n0:08.0 サビ 4小節\n  原曲と違う 2回繰り返す\n';
    const { song } = songFromText(text);
    expect([song.originalKey, song.transpose]).toEqual(['Eb', -2]);
    expect(song.sections.map((s) => [!!s.cut, s.arrange ?? null])).toEqual([[true, null], [false, '2回繰り返す']]);
    expect(validateSong(song)).toBeNull();
    const out = songToText(song);
    expect(out).toContain('キー 原曲 Eb → -2');
    expect(out).toContain('0:00.0 イントロ 4小節\n  カット\n0:08.0 サビ 4小節\n  原曲と違う 2回繰り返す');
  });
});
