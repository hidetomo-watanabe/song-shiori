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
  });
});
