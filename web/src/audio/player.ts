// 端末上の音源を Web Audio で再生する。区間ループのつなぎ目を正確にするため <audio> は使わない

export const MAX_BYTES = 50 * 1024 * 1024;
export const MAX_SECONDS = 15 * 60;

// 拡張子とファイル先頭の内容から形式を確かめる
export async function checkFile(file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) return 'ファイルが大きすぎます（50MBまで）';
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!['mp3', 'wav', 'm4a', 'mp4', 'aac'].includes(ext)) return '対応していない形式です（MP3・WAV・M4A）';
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  const ok =
    ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) || // MP3・AAC(ADTS)
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') || // WAV
    ascii(4, 8) === 'ftyp'; // M4A・MP4
  return ok ? null : 'ファイルの内容が音源として読み取れません';
}

// ループ1周分のサンプル [s, e) を作る。区間の直後に続く音を頭の fade サンプルに等電力クロスフェードで重ね、
// 終わり（e-1）から頭（0）へ戻るところで波形が飛ばないようにする
export function loopSamples(src: Float32Array, s: number, e: number, fade: number): Float32Array {
  const dst = src.slice(s, e);
  for (let i = 0; i < fade && i < dst.length; i++) {
    const x = ((i + 0.5) / fade) * (Math.PI / 2);
    const tail = e + i < src.length ? src[e + i] : 0;
    dst[i] = src[s + i] * Math.sin(x) + tail * Math.cos(x);
  }
  return dst;
}

export class Player {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private looping: { start: number; end: number } | null = null; // 今の再生がループ用の音を使っているときの範囲
  private loopCache: { start: number; end: number; buffer: AudioBuffer } | null = null;
  buffer: AudioBuffer | null = null;
  loop: { start: number; end: number } | null = null;
  playing = false;
  onEnded: () => void = () => {};

  private context() {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  async load(file: File): Promise<AudioBuffer> {
    this.stop();
    const data = await file.arrayBuffer();
    try {
      this.buffer = await this.context().decodeAudioData(data);
    } catch {
      throw new Error('音源を読み込めませんでした。ファイルが壊れているか、このブラウザでは再生できない形式です');
    }
    this.offset = 0;
    this.loopCache = null;
    return this.buffer;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get currentTime(): number {
    if (!this.playing || !this.ctx) return this.offset;
    const elapsed = this.ctx.currentTime - this.startedAt;
    if (this.looping) {
      const { start, end } = this.looping;
      return start + ((this.offset - start + elapsed) % (end - start));
    }
    return Math.min(this.offset + elapsed, this.duration);
  }

  // 利用者の操作（タップ）から呼ぶこと。iPhone ではそれ以外の契機で音が出ない
  play(from?: number) {
    if (!this.buffer) return;
    const ctx = this.context();
    void ctx.resume();
    let at = Math.max(0, Math.min(from ?? this.currentTime, this.duration - 0.01));
    this.stopSource();
    const src = ctx.createBufferSource();
    src.connect(ctx.destination);
    const loop = this.loop && this.loop.end - this.loop.start > 0.05 ? this.loop : null;
    if (loop) {
      // ループ範囲だけを切り出した音を、つなぎ目をなめらかにして繰り返す
      if (at < loop.start || at >= loop.end) at = loop.start;
      src.buffer = this.loopBuffer(loop);
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = src.buffer.duration;
      src.start(0, at - loop.start);
    } else {
      src.buffer = this.buffer;
      src.start(0, at);
    }
    this.looping = loop ? { ...loop } : null;
    src.onended = () => {
      if (this.src !== src) return;
      this.offset = this.duration;
      this.playing = false;
      this.src = null;
      this.onEnded();
    };
    this.src = src;
    this.startedAt = ctx.currentTime;
    this.offset = at;
    this.playing = true;
  }

  pause() {
    this.offset = this.currentTime;
    this.stopSource();
    this.playing = false;
  }

  seek(t: number) {
    if (this.playing) this.play(t);
    else this.offset = Math.max(0, Math.min(t, this.duration));
  }

  setLoop(range: { start: number; end: number } | null) {
    this.loop = range;
    if (!this.playing) return;
    const t = this.currentTime;
    this.play(range && (t < range.start || t >= range.end) ? range.start : t);
  }

  stop() {
    this.stopSource();
    this.playing = false;
    this.offset = 0;
  }

  // ループ用の音を作る。区間の終わりの直後に続く音を、区間の頭に 30ms かけて重ねて（等電力クロスフェード）、
  // 終わりから頭へ戻るところで波形が飛ばず、音が途切れて聞こえないようにする
  private loopBuffer(range: { start: number; end: number }): AudioBuffer {
    const c = this.loopCache;
    if (c && c.start === range.start && c.end === range.end) return c.buffer;
    const b = this.buffer!;
    const sr = b.sampleRate;
    const s = Math.floor(range.start * sr);
    const e = Math.min(b.length, Math.floor(range.end * sr));
    const len = Math.max(1, e - s);
    const fade = Math.min(Math.floor(0.03 * sr), Math.floor(len / 4));
    const out = this.context().createBuffer(b.numberOfChannels, len, sr);
    for (let ch = 0; ch < b.numberOfChannels; ch++) out.getChannelData(ch).set(loopSamples(b.getChannelData(ch), s, s + len, fade));
    this.loopCache = { start: range.start, end: range.end, buffer: out };
    return out;
  }

  private stopSource() {
    const src = this.src;
    this.src = null;
    if (src) {
      src.onended = null;
      try { src.stop(); } catch { /* 開始前 */ }
    }
  }
}
