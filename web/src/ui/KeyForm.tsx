import { useState } from 'preact/hooks';
import { keyFromInput } from './util';

// このブラウザにキーがないとき、受け取った編集リンク・管理リンク（以前の形式のキーも可）を貼って編集を始める。inline でなければ1画面として出す
export function KeyForm({ onSubmit, inline }: { onSubmit: (key: string) => Promise<string | undefined>; inline?: boolean }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const body = (
    <section class="card">
      <h2>リンクを貼り付け</h2>
      <p>このブラウザでは編集できません。受け取った<strong>編集リンク</strong>（メンバー用）か<strong>管理リンク</strong>（作成者用）を開くか、ここに貼り付けてください。</p>
      <p class="sub">自分の別の端末で作った曲メモは、<a href="#/mine">マイキー</a>を使うと、この端末でもそのまま編集できます。</p>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const k = keyFromInput(input);
        setError(k ? (await onSubmit(k)) ?? '' : 'リンクを確認してください');
      }}>
        <input value={input} autoComplete="off" spellcheck={false} placeholder="リンク（以前の48桁のキーも可）" onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)} />
        <button class="primary" type="submit" disabled={!input.trim()}>編集を始める</button>
      </form>
      {error && <p class="error">{error}</p>}
    </section>
  );
  return inline ? body : <main class="page narrow">{body}<a href="#/">トップへ</a></main>;
}
