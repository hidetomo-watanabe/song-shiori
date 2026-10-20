// YouTube の埋め込みプレーヤー（IFrame Player API）で再生する。音は取り出せないため、自動解析には使えない。
// 音源ファイルの Player と同じ操作（再生・停止・移動・区間ループ）を持ち、編集画面からは同じように扱う

export type Range = { start: number; end: number };

// 再生の操作。音源ファイル（Player）と YouTube（YouTubePlayer）の共通部分
export interface Playback {
  readonly duration: number;
  readonly currentTime: number;
  readonly playing: boolean;
  loop: Range | null;
  play(from?: number): void;
  pause(): void;
  seek(t: number): void;
  setLoop(range: Range | null): void;
  stop(): void;
}

let api: Promise<void> | null = null;

// IFrame Player API を読み込む。動画を表示するときまで YouTube には接続しない
function loadApi(): Promise<void> {
  api ??= new Promise<void>((resolve, reject) => {
    const w = window as any;
    if (w.YT?.Player) { resolve(); return; }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { api = null; reject(new Error('YouTube を読み込めませんでした。ネットワークを確かめてください')); };
    document.head.appendChild(s);
  });
  return api;
}

// プレーヤーのエラー番号を、利用者向けの文にする
function errorText(code: number): string {
  if (code === 101 || code === 150) return 'この動画は、ほかのサイトでの再生が許可されていません。YouTube で開いて聴いてください';
  if (code === 100) return '動画が見つかりません（削除されたか、非公開です）';
  if (code === 2) return '動画の URL が正しくありません';
  return '動画を再生できませんでした';
}

const PLAYING = 1, PAUSED = 2, ENDED = 0;

export class YouTubePlayer implements Playback {
  private p: any;
  private want = false; // 再生中か（読み込み中も含む。表示がちらつかないよう、プレーヤーの状態ではなく操作で決める）
  private timer = 0;
  loop: Range | null = null;
  // 構成表の時刻と動画の時刻のずれ（秒）。動画の時刻 = 構成表の時刻 + offset。外から見える時刻はすべて構成表の時刻
  offset = 0;
  onEnded: () => void = () => {};
  onPlay: () => void = () => {}; // 再生が始まったとき（動画の上の操作も含む）
  onError: (message: string) => void = () => {};

  private constructor() {}

  // host の中に動画を表示し、再生できるようになったら返す。プライバシー強化モード（youtube-nocookie.com）を使う
  static async create(host: HTMLElement, videoId: string): Promise<YouTubePlayer> {
    await loadApi();
    const YT = (window as any).YT;
    const self = new YouTubePlayer();
    const el = document.createElement('div');
    host.replaceChildren(el);
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      self.p = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { ready = true; resolve(); },
          onError: (e: { data: number }) => {
            self.want = false;
            if (ready) self.onError(errorText(e.data));
            else reject(new Error(errorText(e.data)));
          },
          onStateChange: (e: { data: number }) => {
            // 動画の上の操作（YouTube のボタン）で再生・停止したときも合わせる
            if (e.data === PLAYING) { self.want = true; self.onPlay(); }
            else if (e.data === PAUSED) self.want = false;
            else if (e.data === ENDED) {
              if (self.loop) { self.seekRaw(self.loop.start); self.p.playVideo(); return; }
              self.want = false;
              self.onEnded();
            }
          },
        },
      });
    });
    // 区間ループ：終わりに来たら頭へ戻す。YouTube は継ぎ目なしのループができないため、戻るときに少し間があく
    self.timer = window.setInterval(() => {
      const l = self.loop;
      if (self.want && l && self.currentTime >= l.end - 0.03) self.seekRaw(l.start);
    }, 30);
    return self;
  }

  get duration(): number {
    return Math.max(0, (this.p?.getDuration?.() ?? 0) - this.offset);
  }

  // 動画の上の時刻（ずれを足す前）
  get videoTime(): number {
    return this.p?.getCurrentTime?.() ?? 0;
  }

  // 構成表の時刻。動画の前置き（構成表の 0 秒より前）を再生している間は 0
  get currentTime(): number {
    return Math.max(0, this.videoTime - this.offset);
  }

  private seekRaw(t: number) {
    this.p.seekTo(Math.max(0, t + this.offset), true);
  }

  get playing(): boolean {
    return this.want;
  }

  // 利用者の操作（タップ）から呼ぶこと。iPhone ではそれ以外の契機で音が出ない
  play(from?: number) {
    let at = from ?? this.currentTime;
    if (this.loop && (at < this.loop.start || at >= this.loop.end)) at = this.loop.start;
    if (from != null || at !== this.currentTime) this.seekRaw(at);
    this.p.playVideo();
    this.want = true;
  }

  pause() {
    this.p.pauseVideo();
    this.want = false;
  }

  seek(t: number) {
    this.seekRaw(Math.max(0, Math.min(t, this.duration)));
  }

  setLoop(range: Range | null) {
    this.loop = range;
    const t = this.currentTime;
    if (this.want && range && (t < range.start || t >= range.end)) this.seekRaw(range.start);
  }

  stop() {
    this.p.pauseVideo();
    this.seekRaw(0);
    this.want = false;
  }

  destroy() {
    clearInterval(this.timer);
    this.want = false;
    try { this.p?.destroy(); } catch { /* すでに外れている */ }
  }
}
