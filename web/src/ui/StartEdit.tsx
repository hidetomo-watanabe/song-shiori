import { useState } from 'preact/hooks';
import { api } from '../api';
import * as L from '../storage/local';
import { go } from './util';

// 閲覧ページから編集を始める。編集キー（メンバー用）か管理キー（作成者用）を入れると、その曲の編集画面に移る
export function StartEdit({ viewId, title }: { viewId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return <button class="small" onClick={() => setOpen(true)}>編集する</button>;
  return (
    <form class="start-edit" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setError('');
      try {
        const k = key.trim().toLowerCase();
        const r = await api.viewSession(viewId, k);
        L.setSession(r.id, r.session, remember);
        if (remember) L.setKeys(r.id, r.role === 'admin' ? { admin: k } : { edit: k });
        L.rememberMine({ id: r.id, title, updatedAt: Date.now() });
        go(`#/e/${r.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : '確認できませんでした');
      } finally {
        setBusy(false);
      }
    }}>
      <p class="sub">作成者から受け取った<strong>編集キー</strong>（または管理キー）を入れてください。</p>
      <input value={key} autoComplete="off" spellcheck={false} placeholder="48桁の英数字" aria-label="編集キー" onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
      <label class="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)} />このブラウザに編集権限を記憶する（共用端末では外してください）</label>
      <div class="actions">
        <button class="small primary" type="submit" disabled={busy || !key.trim()}>編集を始める</button>
        <button class="small" type="button" onClick={() => setOpen(false)}>やめる</button>
      </div>
      {error && <p class="error">{error}</p>}
    </form>
  );
}
