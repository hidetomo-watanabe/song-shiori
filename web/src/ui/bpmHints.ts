import * as M from '../../../shared/song';
import type { Song } from '../../../shared/song';

// 参考にするネット上の BPM。推定とほぼ同じ候補、次に推定の倍・半分の候補、なければいちばん上の候補を使う
// （情報源によって倍の値や別の録音の値が先に来ることがあり、それで正しい推定を作り直さないため）
export function pickNetBpm(est: number | null | undefined, candidates: number[]): number | null {
  const by = (f: (x: ReturnType<typeof M.octaveByReference>) => boolean) => (est != null ? candidates.find((b) => f(M.octaveByReference(est, b))) : undefined);
  return by((x) => x === 1) ?? by((x) => x != null) ?? candidates[0] ?? null;
}

// テンポの欄に出す「この BPM で作り直す」の案内
// netDismissed：ネット上の BPM と大きく違うときに「推定のままにする」を選んだときの推定
export function bpmHints(song: Song, netCandidates: number[], netBpm: number | null, netDismissed: number | null) {
  const estimated = !!song.analysis && song.bpmManual == null && song.bpmEst != null;
  // ネット上の BPM を参考に、推定の倍・半分の取り違えを判定する
  const netFactor = estimated && netBpm != null ? M.octaveByReference(song.bpmEst!, netBpm) : null;
  const octaveFix = netFactor === 2 || netFactor === 0.5 ? Math.round(song.bpmEst! * netFactor * 10) / 10 : null;
  // ネット上の BPM と推定が、倍・半分でもなく大きく違うとき（拍の取り違え。別の録音・別の曲の値のこともある）
  // どれが正しいか分からないので、違う値の候補を並べて選んでもらう
  const netFixes = netFactor === null && netBpm != null && estimated && netDismissed !== song.bpmEst
    ? netCandidates.filter((b, i) => netCandidates.findIndex((x) => M.octaveByReference(x, b, 0.03) === 1) === i).slice(0, 3) : [];
  // 推定が遅め（90未満）なら、2倍のテンポかもしれないと知らせる（半分のテンポへの誤認がよくあるため）
  const slowBpm = estimated && song.bpmEst! < 90 && !song.beatsUncertain && netFactor !== 1 && !octaveFix && !netFixes.length
    ? Math.round(song.bpmEst! * 20) / 10 : null;
  // 手入力の BPM が自動生成時の推定と違うとき（倍・半分の誤認など）は、その BPM でやり直せるようにする
  const redoBpm = song.analysis && song.bpmManual != null && (song.bpmEst == null || Math.abs(song.bpmManual / song.bpmEst - 1) > 0.03) ? song.bpmManual : null;
  return { netFactor, octaveFix, netFixes, slowBpm, redoBpm };
}
