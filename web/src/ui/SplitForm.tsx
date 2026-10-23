import type { Section } from '../../../shared/song';

export type SplitState = { id: string; bars: string; error: string };

// 「分割」：区間の先頭から何小節で分けるかを入力してもらう
export function SplitForm({ s, form, onBars, onSubmit, onCancel }: {
  s: Section; form: SplitState; onBars: (bars: string) => void; onSubmit: () => void; onCancel: () => void;
}) {
  return (
    <form class="split-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <label class="inline">先頭から
        <input type="number" inputMode="numeric" min={1} value={form.bars} autoFocus
          onInput={(e) => onBars((e.currentTarget as HTMLInputElement).value)} />
        小節で分割
      </label>
      <span class="sub">（この区間は {s.barsManual ?? s.barsEst} 小節。分けた位置は小節の頭に合わせます）</span>
      <button class="small primary" type="submit">分割する</button>
      <button class="small" type="button" onClick={onCancel}>キャンセル</button>
      {form.error && <p class="error">{form.error}</p>}
    </form>
  );
}
