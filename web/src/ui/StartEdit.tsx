import { useState } from 'preact/hooks';
import { api } from '../api';
import * as L from '../storage/local';
import { errorText, go, keyFromInput } from './util';

// 閲覧ページから編集を始める。このブラウザにキーがあればそのまま編集画面へ、なければ受け取った編集リンク（以前の形式のキーも可）を貼ってもらう
export function StartEdit({ viewId, title }: { viewId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const known = L.listMine().find((m) => m.viewId === viewId && L.getKey(m.id));
  if (known) return <a class="button small" href={`#/e/${known.id}`}>編集する</a>;
  if (!open) return <button class="small" onClick={() => setOpen(true)}>編集する</button>;
  return (
    <form class="start-edit" onSubmit={async (e) => {
      e.preventDefault();
      const k = keyFromInput(input);
      if (!k) { setError('リンクを確認してください'); return; }
      setBusy(true);
      setError('');
      try {
        const r = await api.open(viewId, k);
        L.setKey(r.id, k);
        L.rememberMine({ id: r.id, title, updatedAt: Date.now(), viewId });
        go(`#/e/${r.id}`);
      } catch (err) {
        setError(errorText(err, '確認できませんでした'));
      } finally {
        setBusy(false);
      }
    }}>
      <p class="sub">作成者から受け取った<strong>編集リンク</strong>を開くか、ここに貼り付けてください。</p>
      <input value={input} autoComplete="off" spellcheck={false} placeholder="編集リンク（以前の48桁のキーも可）" aria-label="編集リンク" onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)} />
      <div class="actions">
        <button class="small primary" type="submit" disabled={busy || !input.trim()}>編集を始める</button>
        <button class="small" type="button" onClick={() => setOpen(false)}>キャンセル</button>
      </div>
      {error && <p class="error">{error}</p>}
    </form>
  );
}
