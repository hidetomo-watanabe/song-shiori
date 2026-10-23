import { describe, expect, it } from 'vitest';
import { emptySong, type Song } from '../shared/song';
import { bpmHints, pickNetBpm } from '../web/src/ui/bpmHints';

// 自動生成したあとの曲（案内の判定では、解析の結果があるかだけを見る）
function analyzed(fields: Partial<Song>): Song {
  return { ...emptySong(200), analysis: {} as NonNullable<Song['analysis']>, ...fields };
}

describe('pickNetBpm', () => {
  it('推定とほぼ同じ候補を、倍・半分の候補より先に使う', () => {
    expect(pickNetBpm(120, [240, 121, 60])).toBe(121);
  });
  it('ほぼ同じ候補がなければ、推定の倍・半分の候補を使う', () => {
    expect(pickNetBpm(120, [90, 240])).toBe(240);
  });
  it('どれも合わなければ、いちばん上の候補を使う', () => {
    expect(pickNetBpm(120, [90, 100])).toBe(90);
    expect(pickNetBpm(null, [90, 100])).toBe(90);
  });
  it('候補がなければ null', () => {
    expect(pickNetBpm(120, [])).toBeNull();
  });
});

describe('bpmHints', () => {
  it('ネット上の BPM が推定の2倍なら、2倍のテンポで作り直す案内を出す', () => {
    const h = bpmHints(analyzed({ bpmEst: 60 }), [120], 120, null);
    expect(h.netFactor).toBe(2);
    expect(h.octaveFix).toBe(120);
    expect(h.netFixes).toEqual([]);
    expect(h.slowBpm).toBeNull();
  });

  it('ネット上の BPM が倍・半分でもなく違えば、違う値の候補を（ほぼ同じ値はまとめて）並べる', () => {
    const h = bpmHints(analyzed({ bpmEst: 120 }), [90, 91, 150], 90, null);
    expect(h.netFactor).toBeNull();
    expect(h.netFixes).toEqual([90, 150]);
  });

  it('「推定のままにする」を選んだ推定には、違う値の候補を出さない', () => {
    expect(bpmHints(analyzed({ bpmEst: 120 }), [90, 150], 90, 120).netFixes).toEqual([]);
  });

  it('推定が遅めなら2倍のテンポかもしれないと知らせる。拍が不確かなら知らせない', () => {
    expect(bpmHints(analyzed({ bpmEst: 80 }), [], null, null).slowBpm).toBe(160);
    expect(bpmHints(analyzed({ bpmEst: 80, beatsUncertain: true }), [], null, null).slowBpm).toBeNull();
    // ネット上の BPM が推定とほぼ同じなら、遅めでもそのまま
    expect(bpmHints(analyzed({ bpmEst: 80 }), [80], 80, null).slowBpm).toBeNull();
  });

  it('手入力の BPM が推定と大きく違えば、その BPM で作り直す案内を出す', () => {
    expect(bpmHints(analyzed({ bpmEst: 120, bpmManual: 130 }), [], null, null).redoBpm).toBe(130);
    expect(bpmHints(analyzed({ bpmEst: 120, bpmManual: 121 }), [], null, null).redoBpm).toBeNull();
    // 手入力があるときは、ネット上の BPM の案内は出さない
    expect(bpmHints(analyzed({ bpmEst: 60, bpmManual: 130 }), [120], 120, null).octaveFix).toBeNull();
  });

  it('自動生成していなければ、案内を出さない', () => {
    const h = bpmHints({ ...emptySong(200), bpmEst: 60, bpmManual: 130 }, [120], 120, null);
    expect(h).toEqual({ netFactor: null, octaveFix: null, netFixes: [], slowBpm: null, redoBpm: null });
  });
});
