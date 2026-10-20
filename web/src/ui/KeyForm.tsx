import { useState } from 'preact/hooks';

// 編集キー・管理キーを入れて編集を始める。inline でなければ1画面として出す
export function KeyForm({ onSubmit, inline }: { onSubmit: (key: string, remember: boolean) => Promise<string | undefined>; inline?: boolean }) {
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const body = (
    <section class="card">
      <h2>キーを入力</h2>
      <p>この曲メモを編集するには、<strong>編集キー</strong>（メンバー用）か<strong>管理キー</strong>（作成者用）が必要です。</p>
      <form onSubmit={async (e) => { e.preventDefault(); setError((await onSubmit(key, remember)) ?? ''); }}>
        <input value={key} autoComplete="off" spellcheck={false} placeholder="48桁の英数字" onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
        <label class="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)} />このブラウザに編集権限を記憶する（共用端末では外してください）</label>
        <button class="primary" type="submit">編集を始める</button>
      </form>
      {error && <p class="error">{error}</p>}
    </section>
  );
  return inline ? body : <main class="page narrow">{body}<a href="#/">トップへ</a></main>;
}
