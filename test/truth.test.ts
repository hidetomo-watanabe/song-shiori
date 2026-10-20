import { describe, expect, it } from 'vitest';
import { emptySong, newSection, normalize } from '../shared/song';
import { parseTruth, songToTruth } from '../shared/truth';

describe('正解データのテキスト形式', () => {
  it('README の書き方を読める', () => {
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

  it('曲メモを書き出して読み戻すと、区間の時刻・名前・小節数が一致する', () => {
    let t = 0;
    const sections = [8, 16, 8].map((bars, i) => { const s = newSection(t, t + bars * 2, { name: ['イントロ', 'Aメロ', 'サビ'][i], nameAuto: false }); t += bars * 2; return s; });
    const song = normalize({ ...emptySong(t), title: '曲', bpmEst: 120, firstDownbeat: 0, sections });
    const back = parseTruth(songToTruth(song));
    expect(back.bpm).toBe(120);
    expect(back.sections.map((s) => [s.start, s.end, s.name, s.bars])).toEqual([[0, 16, 'イントロ', 8], [16, 48, 'Aメロ', 16], [48, 64, 'サビ', 8]]);
  });
});
