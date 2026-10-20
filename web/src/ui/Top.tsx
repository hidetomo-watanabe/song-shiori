import { useEffect, useState } from 'preact/hooks';
import { checkFile } from '../audio/player';
import { forgetMine, listMine, loadDraft, removeDraft, type DraftRecord } from '../storage/local';
import { fmtDate, go, handoff } from './util';

export function Top() {
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [mine, setMine] = useState(listMine());
  const [agreed, setAgreed] = useState(false);

  useEffect(() => { void loadDraft('draft').then(setDraft); }, []);

  const confirmReplace = () => !draft || window.confirm('作成中の下書きがあります。新しく作ると下書きは破棄されます。よろしいですか？');

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const err = await checkFile(file);
    if (err) { setError(err); return; }
    if (!confirmReplace()) return;
    await removeDraft('draft');
    handoff.file = file;
    go('#/new');
  }

  async function manual(fromText = false) {
    if (!confirmReplace()) return;
    await removeDraft('draft');
    go(fromText ? '#/new?import' : '#/new?manual');
  }

  return (
    <main class="page narrow">
      <header class="hero">
        <div class="brand">
          <img src="./favicon.svg" alt="" />
          <h1>曲のしおり</h1>
        </div>
        <p>音源から曲の構成（区切り・繰り返し・小節数）を下書きして、聴きながら直し、バンドメンバーと共有できます。構成の勘違いをなくすための構成表です。</p>
      </header>

      {draft && (
        <section class="card notice">
          <p>作成中の下書きがあります（{fmtDate(draft.updatedAt)} 更新・{draft.song.title || '曲名未入力'}）。</p>
          <div class="actions"><button class="primary" onClick={() => go('#/new')}>下書きを開く</button></div>
        </section>
      )}

      <section class="card start">
        <h2>音源から作る</h2>
        <ul class="points">
          <li>音源は<strong>この端末の中だけで解析</strong>し、サーバーへは送信しません。保存されるのは構成表だけです。</li>
          <li>対応形式：MP3・WAV・M4A（50MB・15分まで）。一定テンポ・4/4 の曲が得意です。</li>
          <li>自分で用意した音源や、練習用に正当に入手した音源を使ってください。</li>
          <li>保存した構成表は、最後の保存から180日間保管されます。</li>
        </ul>
        <div class="agree">
          <label class="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed((e.currentTarget as HTMLInputElement).checked)} />
            上記を確認しました
          </label>
        </div>
        <label class={`button primary large file ${agreed ? '' : 'disabled'}`}>
          音源ファイルを選ぶ
          <input type="file" accept=".mp3,.wav,.m4a,.mp4,.aac,audio/*" disabled={!agreed} onChange={pick} />
        </label>
        {error && <p class="error">{error}</p>}

        <p class="or">音源がない・解析がうまくいかないときは</p>
        <div class="alt-start">
          <button onClick={() => manual()}><b>手動で作る</b><span>区間を自分で足して、構成表を作ります</span></button>
          <button onClick={() => manual(true)}><b>テキストから作る</b><span>書き出しておいた構成表を読み込みます</span></button>
        </div>
      </section>

      {mine.length > 0 && (
        <section class="card">
          <h2>このブラウザで編集した曲メモ</h2>
          <ul class="mine">
            {mine.map((m) => (
              <li key={m.id}>
                <a href={`#/e/${m.id}`}>{m.title || '曲名未入力'}</a>
                <span class="sub">{fmtDate(m.updatedAt)}</span>
                <button class="small ghost" onClick={() => { forgetMine(m.id); setMine(listMine()); }}>一覧から外す</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
