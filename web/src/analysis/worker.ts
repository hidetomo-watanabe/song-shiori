// 解析を Web Worker で実行し、画面操作を止めない
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { analyze, ANALYSIS_SR } from './core';
import { vocalCurve, type VocalCurve, type VocalModel } from './vocal';

// vocals：歌の割合の推定。curve（前に求めた結果）か、44.1kHz の左右とモデルの URL
export type VocalInput = { curve: VocalCurve } | { left: Float32Array; right: Float32Array; modelUrl: string };
export type WorkerRequest = { samples: Float32Array; bpm?: number; vocals?: VocalInput };
export type WorkerMessage =
  | { type: 'progress'; ratio: number; stage: string }
  | { type: 'done'; result: ReturnType<typeof analyze>; ms: number; vocals?: VocalCurve }
  | { type: 'error'; message: string };

// 歌のモデル（onnxruntime-web）は、歌の割合を推定するときだけ読み込む。
// 公開先（GitHub Pages）では複数スレッドに必要なヘッダーを付けられないので、1スレッドで動かす
async function loadModel(url: string): Promise<VocalModel> {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  const session = await ort.InferenceSession.create(url);
  return async (x) => (await session.run({ x: new ort.Tensor('float32', x, [2, 1, 512, 1024]) })).y.data as Float32Array;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);
  const t0 = performance.now();
  const v = e.data.vocals;
  let vocals = v && 'curve' in v ? v.curve : undefined;
  // 歌の割合を求めるときは、進み具合の前半を歌の推定、後半を構成の解析に割り当てる
  const share = v && !vocals ? 0.5 : 0;
  if (v && 'left' in v) {
    try {
      post({ type: 'progress', ratio: 0, stage: '歌の部分を推定しています（初回はモデルを読み込みます）' });
      const model = await loadModel(v.modelUrl);
      vocals = await vocalCurve(v.left, v.right, model, (r) => post({ type: 'progress', ratio: r * share, stage: '歌の部分を推定しています' }));
    } catch (err) {
      // 読み込めない・メモリが足りないなどのときは、歌の割合なしで続ける（名前の候補は繰り返し・並び・音量だけで決める）
      console.warn('歌の割合を推定できませんでした', err);
    }
  }
  try {
    const result = analyze(e.data.samples, ANALYSIS_SR, (ratio, stage) => post({ type: 'progress', ratio: share + ratio * (1 - share), stage }), { bpm: e.data.bpm, vocals });
    post({ type: 'done', result, ms: performance.now() - t0, vocals });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : '解析に失敗しました' });
  }
};
