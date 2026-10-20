import type { Range } from './youtube';

// BPM を耳で確かめるためのメトロノーム。曲を再生している間は曲の拍（beats）に合わせて鳴らし、
// 止まっているときは bpm の間隔で鳴らす。鳴らしている間に bpm・beatsPerBar・beats を変えると、次の拍から反映する

const AHEAD = 0.1; // どれだけ先の拍まで予約するか（秒）。タイマーの遅れで音がもたつかないよう、Web Audio の時刻で予約する
const GAP = 0.1; // これより近い拍は鳴らさない（同じ拍を二重に鳴らさないため。BPM 400 でも拍の間隔は 0.15 秒）

export type Beat = { t: number; head: boolean }; // 曲の頭からの時刻と、小節の頭か
// 再生中の曲の位置（曲の頭からの秒）・再生が終わる時刻・区間ループの範囲。止まっていれば null
export type Clock = () => { t: number; end: number; loop: Range | null } | null;

export class Metronome {
  private timer = 0;
  private until = 0; // ここ（AudioContext の時刻）までの拍は予約済み
  private last = -Infinity; // 最後に鳴らした時刻（AudioContext の時刻）
  private next = 0; // 止まっているとき：次の拍を鳴らす時刻
  private count = 0; // 止まっているとき：鳴らし始めてから何拍目か
  bpm = 120;
  beatsPerBar = 4;
  beats: Beat[] | null = null;

  // context は再生と同じ AudioContext。clock は再生中の曲の位置
  constructor(private context: () => AudioContext, private clock: Clock) {}

  get running() {
    return this.timer !== 0;
  }

  // 利用者の操作（タップ）から呼ぶこと。iPhone ではそれ以外の契機で音が出ない
  start() {
    if (this.running) return;
    void this.context().resume();
    this.until = 0;
    this.next = 0;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private schedule() {
    const now = this.context().currentTime;
    const pos = this.beats?.length ? this.clock() : null;
    if (pos) this.scheduleSynced(now, pos);
    else this.scheduleFree(now);
  }

  // 再生中：曲の拍の位置に合わせる。曲の位置を AudioContext の時刻に直して予約する。
  // 区間ループでは、終わりまでの拍に続けて、頭に戻ったあとの拍も予約する（戻った直後の小節の頭を取りこぼさないため）
  private scheduleSynced(now: number, { t, end, loop }: { t: number; end: number; loop: Range | null }) {
    const horizon = now + AHEAD;
    // 曲の位置の範囲 [from, to) と、曲の位置に足すと AudioContext の時刻になる値
    const spans: [number, number, number][] = [[t, loop?.end ?? end, now - t]];
    if (loop) spans.push([loop.start, loop.end, now + (loop.end - t) - loop.start]);
    for (const [from, to, base] of spans) {
      for (const b of this.beats!) {
        if (b.t < from || b.t >= to) continue;
        const at = base + b.t;
        if (at >= horizon) break;
        if (at >= this.until) this.click(Math.max(at, now), b.head);
      }
    }
    this.until = horizon;
    this.next = 0; // 止めたら、止めたところから bpm の間隔で鳴らし始める
  }

  // 止まっているとき：bpm の間隔で鳴らす
  private scheduleFree(now: number) {
    this.until = now;
    if (!(this.bpm > 0)) return;
    if (this.next < now) { this.next = now + 0.05; this.count = 0; }
    while (this.next < now + AHEAD) {
      this.click(this.next, this.count % Math.max(1, this.beatsPerBar) === 0);
      this.next += 60 / this.bpm;
      this.count++;
    }
  }

  // 短い「カッ」という音。小節の頭は高く強めにする
  private click(at: number, accent: boolean) {
    if (at < this.last + GAP) return;
    this.last = at;
    const ctx = this.context();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1600 : 1000;
    gain.gain.setValueAtTime(accent ? 0.5 : 0.3, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }
}
