import { useEffect, useState } from 'preact/hooks';
import * as L from '../storage/local';
import { deleteMyKey, isMyKey, myKeyExists, myKeyUrl, newMyKey } from '../storage/mykey';
import { CopyRow } from './CopyRow';
import { MineList } from './MineList';
import { errorText } from './util';

// 作ったもの・マイキー（#/mine。ライブのしおりと同じ）：このブラウザにあるリンクのキーで一覧を出す。マイキーで別の端末と揃えられる。
// マイキーのリンク（#/mine?k=）で開いたときは、main.tsx でこの端末に保存してアドレスバーから消してある
export function Mine() {
  const [my, setMy] = useState(L.getMyKey());
  const [synced, setSynced] = useState<{ count: number | null; error: string } | null>(null);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0); // マイキーを変えたら一覧を作り直す（同期し直す）

  useEffect(() => {
    const before = document.title;
    document.title = '作ったもの・マイキー｜曲のしおり';
    return () => { document.title = before; };
  }, []);

  const changed = () => { setMy(L.getMyKey()); setSynced(null); setError(''); setN((x) => x + 1); };

  async function use() {
    const m = input.trim().toLowerCase().match(/^(?:.*[?&]k=)?([a-f0-9]{48})$/);
    if (!m || !isMyKey(m[1])) { setError('マイキーのリンクを確認してください'); return; }
    setBusy(true);
    setError('');
    try {
      if (!(await myKeyExists(m[1]))) { setError('このマイキーは見つかりません。リンクを確認してください'); return; }
      L.setMyKey(m[1]);
      setInput('');
      changed();
    } catch (e) {
      setError(errorText(e, '確認できませんでした'));
    } finally {
      setBusy(false);
    }
  }

  const solo = 'マイキーは自分専用です。メンバーと一緒に使うときは、マイキーではなく、曲メモごとの閲覧URLや編集リンクを送ってください。';
  return (
    <main class="page narrow">
      <header class="hero">
        <h1>作ったもの</h1>
        <p>{my ? 'このブラウザと、同じマイキーを使っている端末で作成した、または編集リンク・管理リンクを開いた曲メモです。' : 'このブラウザで作成した、または編集リンク・管理リンクを開いた曲メモです。別の端末やブラウザで作ったものは表示されません。'}</p>
      </header>

      <section class="card">
        <h2>マイキー</h2>
        {my ? (
          <>
            <p class="sub">同じマイキーを使っている端末どうしで、この一覧と編集の権限が揃います{synced?.count != null ? `（${synced.count}件）` : ''}。別の端末では、下のリンクを一度開いてください。</p>
            {synced?.error && <p class="warn">同期できませんでした：{synced.error}</p>}
            <CopyRow value={myKeyUrl(my)} />
            <p class="sub">マイキーのリンクを持つ人は、ここにあるすべての曲メモを編集できます。自分以外には送らないでください。なくすと取り戻せません（各端末にはこれまでどおり残ります）。</p>
            <p class="sub">{solo}</p>
            <div class="actions">
              <button class="small" onClick={() => {
                if (!window.confirm('この端末でマイキーを使うのをやめます。\nこの端末の一覧はそのまま残りますが、ほかの端末とは揃わなくなります。やめますか？')) return;
                L.setMyKey(null);
                changed();
              }}>この端末でマイキーを使うのをやめる</button>
              <button class="small danger" disabled={busy} onClick={async () => {
                if (!window.confirm('マイキーを削除します。\nサーバーに保存した一覧が消え、どの端末でもこのマイキーは使えなくなります。各端末で開ける曲メモはそのまま残ります。削除しますか？')) return;
                setBusy(true);
                try { await deleteMyKey(); changed(); } catch (e) { setError(errorText(e, '削除できませんでした')); } finally { setBusy(false); }
              }}>マイキーを削除</button>
            </div>
          </>
        ) : (
          <>
            <p class="sub">マイキーを作ると、別の端末やブラウザでも同じ一覧が表示され、そのまま編集できます。登録やログインは要りません。</p>
            <p class="sub">{solo}</p>
            <div class="actions">
              <button class="primary" onClick={() => { L.setMyKey(newMyKey()); changed(); }}>マイキーを作る</button>
            </div>
            <form class="mykey-use" onSubmit={(e) => { e.preventDefault(); void use(); }}>
              <input value={input} autoComplete="off" spellcheck={false} placeholder="ほかの端末で作ったマイキーのリンクを貼り付け" aria-label="マイキーのリンク"
                onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)} />
              <button class="small" type="submit" disabled={busy || !input.trim()}>この端末で使う</button>
            </form>
          </>
        )}
        {error && <p class="error">{error}</p>}
      </section>

      <section class="card">
        <h2>曲メモ</h2>
        <MineList key={n} empty={my ? 'このブラウザと同じマイキーの端末で作った曲メモはありません。' : 'このブラウザで作った曲メモはありません。'}
          onSync={(count, err) => { setMy(L.getMyKey()); setSynced({ count, error: err }); }} />
      </section>
      <a href="#/">トップへ</a>
    </main>
  );
}
