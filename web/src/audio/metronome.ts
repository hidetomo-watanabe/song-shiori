// BPM を耳で確かめるためのメトロノーム。曲の再生とは別に鳴らす（再生しながら重ねて、テンポが合っているか比べられる）。
// 鳴らしている間に bpm・beatsPerBar を変えると、次の拍から反映する

const AHEAD = 0.1; // どれだけ先の拍まで予約するか（秒）。タイマーの遅れで音がもたつかないよう、Web Audio の時刻で予約する

export class Metronome {
  private ctx: AudioContext | null = null;
  private timer = 0;
  private next = 0; // 次の拍を鳴らす時刻（AudioContext の時刻）
  private count = 0; // 鳴らし始めてから何拍目か
  bpm = 120;
  beatsPerBar = 4;

  get running() {
    return this.timer !== 0;
  }

  // 利用者の操作（タップ）から呼ぶこと。iPhone ではそれ以外の契機で音が出ない
  start() {
    if (this.running || !(this.bpm > 0)) return;
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    this.next = this.ctx.currentTime + 0.05;
    this.count = 0;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }

  private schedule() {
    const ctx = this.ctx!;
    if (!(this.bpm > 0)) { this.stop(); return; }
    while (this.next < ctx.currentTime + AHEAD) {
      this.click(this.next, this.count % Math.max(1, this.beatsPerBar) === 0);
      this.next += 60 / this.bpm;
      this.count++;
    }
  }

  // 短い「カッ」という音。小節の頭は高く強めにする
  private click(at: number, accent: boolean) {
    const ctx = this.ctx!;
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
