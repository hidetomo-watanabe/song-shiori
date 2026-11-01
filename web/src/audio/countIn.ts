import type { Beat, Metronome } from './metronome';
import { Player } from './player';
import type { Playback } from './youtube';

// 再生の前にカウントを鳴らしてから再生する。音源ファイルはカウントの後の時刻に鳴らし始めるよう予約するのでずれない。
// YouTube の動画は時刻を予約できないので、カウントの後に再生の命令を出す（動画の読み込みの具合で少し遅れることがある）。
// 区間ループで頭に戻るたび・再生中の移動では鳴らさない（呼ぶのは再生を始める操作だけ）
export class CountIn {
  private timer = 0;
  constructor(private metronome: Metronome) {}

  // YouTube の動画で、カウントを鳴らしていて再生を待っている間
  get waiting() {
    return this.timer !== 0;
  }

  // m を from（なければ今の位置）から再生する。plan は再生を始める曲の時刻からカウントの位置を求める（null ならすぐ再生）。
  // onStart は再生が始まったとき（YouTube はカウントの後）に呼ぶ。利用者の操作（タップ）から呼ぶこと
  play(m: Playback, from: number | undefined, plan: (t: number) => Beat[] | null, onStart?: () => void) {
    this.cancel();
    let at = from ?? m.currentTime;
    if (m.loop && (at < m.loop.start || at >= m.loop.end)) at = m.loop.start;
    const clicks = plan(at);
    if (!clicks?.length) { m.play(from); onStart?.(); return; }
    if (m.playing) m.pause(); // 再生中に別の区間から再生し直すときは、カウントの間は止めておく
    const { at: when, wait } = this.metronome.countIn(clicks, at);
    if (m instanceof Player) { m.play(at, when); onStart?.(); return; }
    this.timer = window.setTimeout(() => { this.timer = 0; m.play(at); onStart?.(); }, wait * 1000);
  }

  // カウントを取り消す（カウントの途中で止めたとき・再生位置を動かしたとき）
  cancel() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.metronome.cancelCount();
  }
}
