// 解析の進み具合
export function Progress({ p, onCancel }: { p: { ratio: number; stage: string }; onCancel?: () => void }) {
  return (
    <div class="progress" role="status">
      <div class="meter"><div style={{ width: `${Math.round(p.ratio * 100)}%` }} /></div>
      <span>{p.stage}（{Math.round(p.ratio * 100)}%）この端末の中で解析しています。ページを閉じると中断されます。</span>
      {onCancel && <button class="small" onClick={onCancel}>中止</button>}
    </div>
  );
}
