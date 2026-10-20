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

export class Player {
  private ctx: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
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
    return this.buffer;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get currentTime(): number {
    if (!this.playing || !this.ctx) return this.offset;
    let t = this.offset + (this.ctx.currentTime - this.startedAt);
    if (this.loop && t >= this.loop.end) {
      const len = this.loop.end - this.loop.start;
      t = this.loop.start + ((t - this.loop.start) % len);
    }
    return Math.min(t, this.duration);
  }

  // 利用者の操作（タップ）から呼ぶこと。iPhone ではそれ以外の契機で音が出ない
  play(from?: number) {
    if (!this.buffer) return;
    const ctx = this.context();
    void ctx.resume();
    const at = Math.max(0, Math.min(from ?? this.currentTime, this.duration - 0.01));
    this.stopSource();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(ctx.destination);
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.onended = () => {
      if (this.src !== src) return;
      this.offset = this.duration;
      this.playing = false;
      this.src = null;
      this.onEnded();
    };
    src.start(0, at);
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

  private stopSource() {
    const src = this.src;
    this.src = null;
    if (src) {
      src.onended = null;
      try { src.stop(); } catch { /* 開始前 */ }
    }
  }
}
