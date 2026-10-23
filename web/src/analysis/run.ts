// 画面側から解析を呼び出す。中止できるように Worker を返す
import type { AnalysisResult } from '../../../shared/song';
import { ANALYSIS_SR } from './core';
import { VOCAL_SR, type VocalCurve } from './vocal';
import type { VocalInput, WorkerMessage } from './worker';

// 再生用の音源を、指定のサンプリング周波数・チャンネル数に変換する（モノラルの音源をステレオにすると左右に同じものが入る）
async function render(buffer: AudioBuffer, sr: number, channels: number): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(channels, Math.ceil(buffer.duration * sr), sr);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return Array.from({ length: channels }, (_, c) => rendered.getChannelData(c).slice());
}

// 再生用の音源から、解析用の 22050Hz モノラルデータを作る
export async function toAnalysisSamples(buffer: AudioBuffer): Promise<Float32Array> {
  return (await render(buffer, ANALYSIS_SR, 1))[0];
}

// 歌の割合の推定に使う、44.1kHz ステレオのデータとモデルの場所
export async function toVocalInput(buffer: AudioBuffer): Promise<VocalInput> {
  const [left, right] = await render(buffer, VOCAL_SR, 2);
  return { left, right, modelUrl: new URL('models/spleeter-vocals.fp16.onnx', document.baseURI).href };
}

export type AnalysisJob = { promise: Promise<{ result: AnalysisResult; ms: number; vocals?: VocalCurve }>; cancel: () => void };

// bpm を渡すと、そのテンポを前提に拍・小節・区切りを推定する。vocals を渡すと、区間ごとの歌の割合も求める
export function runAnalysis(samples: Float32Array, onProgress: (ratio: number, stage: string) => void, bpm?: number, vocals?: VocalInput): AnalysisJob {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<{ result: AnalysisResult; ms: number; vocals?: VocalCurve }>((res, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.ratio, m.stage);
      else if (m.type === 'done') { worker.terminate(); res({ result: m.result, ms: m.ms, vocals: m.vocals }); }
      else { worker.terminate(); rej(new Error(m.message)); }
    };
    worker.onerror = () => { worker.terminate(); rej(new Error('解析中にエラーが発生しました。端末のメモリが不足している可能性があります')); };
  });
  const transfer: Transferable[] = [samples.buffer];
  if (vocals && 'left' in vocals) transfer.push(vocals.left.buffer, vocals.right.buffer);
  worker.postMessage({ samples, bpm, vocals }, transfer);
  return { promise, cancel: () => { worker.terminate(); reject(new Error('解析を中止しました')); } };
}
