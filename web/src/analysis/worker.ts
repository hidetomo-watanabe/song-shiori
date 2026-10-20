// 解析を Web Worker で実行し、画面操作を止めない
import { analyze, ANALYSIS_SR } from './core';

export type WorkerRequest = { samples: Float32Array };
export type WorkerMessage =
  | { type: 'progress'; ratio: number; stage: string }
  | { type: 'done'; result: ReturnType<typeof analyze>; ms: number }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);
  const t0 = performance.now();
  try {
    const result = analyze(e.data.samples, ANALYSIS_SR, (ratio, stage) => post({ type: 'progress', ratio, stage }));
    post({ type: 'done', result, ms: performance.now() - t0 });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : '解析に失敗しました' });
  }
};
