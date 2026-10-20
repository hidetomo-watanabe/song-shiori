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
        <h1>曲のしおり</h1>
        <p>音源から曲の構成（区切り・繰り返し・小節数）を下書きして、聴きながら直し、バンドメンバーと共有できます。構成の勘違いをなくすための構成表です。</p>
      </header>

      {draft && (
        <section class="card notice">
          <p>作成中の下書きがあります（{fmtDate(draft.updatedAt)} 更新・{draft.song.title || '曲名未入力'}）。</p>
          <button class="primary" onClick={() => go('#/new')}>下書きを開く</button>
        </section>
      )}

      <section class="card">
        <h2>音源から作る</h2>
        <ul class="points">
          <li>音源は<strong>この端末の中だけで解析</strong>し、サーバーへは送信しません。保存されるのは構成表だけです。</li>
          <li>対応形式：MP3・WAV・M4A（50MB・15分まで）。一定テンポ・4/4 の曲が得意です。</li>
          <li>自分で用意した音源や、練習用に正当に入手した音源を使ってください。</li>
          <li>保存した構成表は、最後の保存から180日間保管されます。</li>
        </ul>
        <label class="check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed((e.currentTarget as HTMLInputElement).checked)} />
          上記を確認しました
        </label>
        <label class={`button primary file ${agreed ? '' : 'disabled'}`}>
          音源ファイルを選ぶ
          <input type="file" accept=".mp3,.wav,.m4a,.mp4,.aac,audio/*" disabled={!agreed} onChange={pick} />
        </label>
        {error && <p class="error">{error}</p>}
        <p class="sub">音源がない場合や解析がうまくいかない場合は、<button class="link" onClick={() => manual()}>構成表を手動で作る</button>ことも、書き出しておいた<button class="link" onClick={() => manual(true)}>テキストから構成を作る</button>こともできます。</p>
      </section>

      {mine.length > 0 && (
        <section class="card">
          <h2>このブラウザで作った曲メモ</h2>
          <ul class="mine">
            {mine.map((m) => (
              <li key={m.id}>
                <a href={`#/e/${m.id}`}>{m.title || '曲名未入力'}</a>
                <span class="sub">{fmtDate(m.updatedAt)}</span>
                <button class="link sub" onClick={() => { forgetMine(m.id); setMine(listMine()); }}>一覧から外す</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
