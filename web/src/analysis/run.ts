// 画面側から解析を呼び出す。中止できるように Worker を返す
import type { AnalysisResult } from '../../../shared/song';
import { ANALYSIS_SR } from './core';
import type { WorkerMessage } from './worker';

// 再生用の音源から、解析用の 22050Hz モノラルデータを作る
export async function toAnalysisSamples(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * ANALYSIS_SR);
  const ctx = new OfflineAudioContext(1, length, ANALYSIS_SR);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

export type AnalysisJob = { promise: Promise<{ result: AnalysisResult; ms: number }>; cancel: () => void };

// bpm を渡すと、そのテンポを前提に拍・小節・区切りを推定する
export function runAnalysis(samples: Float32Array, onProgress: (ratio: number, stage: string) => void, bpm?: number): AnalysisJob {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let reject: (e: Error) => void = () => {};
  const promise = new Promise<{ result: AnalysisResult; ms: number }>((res, rej) => {
    reject = rej;
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const m = e.data;
      if (m.type === 'progress') onProgress(m.ratio, m.stage);
      else if (m.type === 'done') { worker.terminate(); res({ result: m.result, ms: m.ms }); }
      else { worker.terminate(); rej(new Error(m.message)); }
    };
    worker.onerror = () => { worker.terminate(); rej(new Error('解析中にエラーが発生しました。端末のメモリが不足している可能性があります')); };
  });
  worker.postMessage({ samples, bpm }, [samples.buffer]);
  return { promise, cancel: () => { worker.terminate(); reject(new Error('解析を中止しました')); } };
}
