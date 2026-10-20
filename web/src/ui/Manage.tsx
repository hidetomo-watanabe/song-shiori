import { useState } from 'preact/hooks';
import { api, randomHex, type MemoInfo } from '../api';
import * as L from '../storage/local';
import { ShareButtons } from './ShareButtons';
import { copy, fmtDay, memberMessage, shareMessage, shareTitle, viewUrl } from './util';

type Props = {
  id: string;
  title: string;
  artist: string;
  meta: MemoInfo;
  session: string;
  onMeta: (m: MemoInfo) => void;
  onSession: (s: string) => void;
  onDeleted: () => void;
};

// 共有URL・編集キー・管理キー・保持期限・削除の管理（要件定義書 5.4）。管理キーで開いているときだけ表示する
export function Manage({ id, title, artist, meta, session, onMeta, onSession, onDeleted }: Props) {
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [keys, setKeysState] = useState(() => L.getKeys(id));
  // 新しいキーは、編集権限を記憶しているブラウザにだけ保存する（記憶しない選択の共用端末などには残さない）
  const saveKeys = (patch: { admin?: string | null; edit?: string | null }) => {
    const keep = Object.fromEntries(Object.entries(patch).filter(([, v]) => v === null || L.remembersSession(id)));
    L.setKeys(id, keep);
    setKeysState(L.getKeys(id));
  };
  const [newEditKey, setNewEditKey] = useState('');
  const [confirm, setConfirm] = useState<'' | 'rekey' | 'editkey' | 'stopedit' | 'unshare' | 'reshare' | 'delete'>('');
  const [copied, setCopied] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作できませんでした'); }
    setConfirm('');
  };

  const url = meta.viewId ? viewUrl(meta.viewId) : null;

  return (
    <section class="card manage">
      <h2>共有と管理</h2>
      <div class="manage-row">
        <h3>閲覧URL</h3>
        {url ? (
          <div class="copy-row">
            <code>{url}</code>
            <button onClick={async () => setCopied(await copy(url))}>{copied ? 'コピー済み' : 'コピー'}</button>
            <a class="button" href={url} target="_blank" rel="noopener">開く</a>
          </div>
        ) : <p class="warn">共有は無効になっています。</p>}
        {/* 見てもらうだけのときは、曲名と閲覧 URL を送る（編集キーは入れない） */}
        {url && <ShareButtons text={() => shareMessage(title, artist, url)} title={shareTitle(title)} />}
        <div class="actions">
          {confirm === 'reshare' ? (
            <>
              <span>再発行すると、今の閲覧URLは使えなくなります。メンバーに新しいURLを送り直してください。</span>
              <button class="danger" onClick={() => run(async () => onMeta(await api.reshare(id, session)))}>新しいURLを発行</button>
              <button onClick={() => setConfirm('')}>キャンセル</button>
            </>
          ) : <button onClick={() => setConfirm('reshare')}>閲覧URLを再発行</button>}
          {url && (confirm === 'unshare' ? (
            <>
              <span>無効にすると、閲覧URLで見られなくなります（あとで新しいURLを発行できます）。</span>
              <button class="danger" onClick={() => run(async () => onMeta(await api.unshare(id, session)))}>共有を無効にする</button>
              <button onClick={() => setConfirm('')}>キャンセル</button>
            </>
          ) : <button onClick={() => setConfirm('unshare')}>共有を無効にする</button>)}
        </div>
      </div>

      <div class="manage-row">
        <h3>編集キー（メンバー用）</h3>
        <p class="sub">メンバーが閲覧ページの「編集する」で入れると、構成を直して保存できます。削除や共有の管理はできません。</p>
        {newEditKey ? (
          <>
            <p class="warn">新しい編集キーを発行しました。古い編集キーは使えなくなりました。メンバーに新しい編集キーを送り直してください。</p>
            <div class="copy-row"><code>{newEditKey}</code><button onClick={() => void copy(newEditKey)}>コピー</button></div>
          </>
        ) : confirm === 'editkey' ? (
          <div class="actions">
            <span>{meta.editKey ? '再発行すると、古い編集キーは使えなくなり、メンバーは新しい編集キーを入れ直す必要があります。' : 'メンバーに渡す編集キーを発行します。'}</span>
            <button class={meta.editKey ? 'danger' : 'primary'} onClick={() => run(async () => {
              const key = randomHex(24);
              onMeta(await api.editKey(id, session, key));
              setNewEditKey(key);
              saveKeys({ edit: key });
            })}>{meta.editKey ? '再発行する' : '発行する'}</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : confirm === 'stopedit' ? (
          <div class="actions">
            <span>止めると、編集キーが使えなくなり、メンバーは編集できなくなります（閲覧はできます）。</span>
            <button class="danger" onClick={() => run(async () => { onMeta(await api.stopEdit(id, session)); saveKeys({ edit: null }); })}>メンバーの編集を止める</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : (
          <>
            <div class="actions">
              {meta.editKey ? <KeyView value={keys.edit} /> : <span>未発行（メンバーは編集できません）</span>}
              <button onClick={() => setConfirm('editkey')}>{meta.editKey ? '編集キーを再発行' : '編集キーを発行'}</button>
              {meta.editKey && <button class="danger" onClick={() => setConfirm('stopedit')}>メンバーの編集を止める</button>}
            </div>
            {/* 編集もしてほしいメンバーには、閲覧 URL と編集キーを送る。キーの操作とは行を分ける */}
            {meta.editKey && keys.edit && url && (
              <ShareButtons text={() => memberMessage(title, artist, url, keys.edit!)} title={shareTitle(title)} copyLabel="メンバーに送る文をコピー" copied="閲覧URLと編集キーをコピーしました。" />
            )}
          </>
        )}
      </div>

      <div class="manage-row">
        <h3>管理キー（作成者用）</h3>
        {newKey ? (
          <>
            <p class="warn">新しい管理キーを発行しました。古い管理キーは使えなくなり、古い管理キーで開いていたほかの端末では入れ直しが必要です。<strong>新しいキーは、なくすと復旧できません。</strong></p>
            <div class="copy-row"><code>{newKey}</code><button onClick={() => void copy(newKey)}>コピー</button></div>
          </>
        ) : confirm === 'rekey' ? (
          <div class="actions">
            <span>再発行すると、古い管理キーは使えなくなり、古い管理キーで開いていたほかの端末では入れ直しが必要になります。このブラウザはそのまま使えます。編集キーとメンバーには影響しません。</span>
            <button class="danger" onClick={() => run(async () => {
              const key = randomHex(24);
              const r = await api.rekey(id, session, key);
              onSession(r.session);
              setNewKey(key);
              saveKeys({ admin: key });
            })}>再発行する</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : (
          <div class="actions">
            {keys.admin ? <KeyView value={keys.admin} /> : (
              <StoreKey id={id} role="admin" onStored={() => setKeysState(L.getKeys(id))}
                note="このブラウザには保存されていません。作成時に控えた管理キーは、引き続き使えます。" />
            )}
            <button onClick={() => setConfirm('rekey')}>管理キーを再発行</button>
          </div>
        )}
        {(keys.admin || keys.edit) && (
          <p class="sub">キーはこのブラウザにだけ保存しています。共用の端末では<button class="link" onClick={() => { L.forgetKeys(id); setKeysState({}); }}>このブラウザからキーを消す</button>。</p>
        )}
      </div>

      <div class="manage-row">
        <h3>保持期限</h3>
        <p>{fmtDay(meta.expiresAt)} まで（最後の保存から180日。閲覧だけでは延びません）</p>
        <button onClick={() => run(async () => onMeta(await api.extend(id, session)))}>今日から180日に延長</button>
      </div>

      <div class="manage-row">
        <h3>削除</h3>
        {confirm === 'delete' ? (
          <div class="actions">
            <span>削除すると、構成メモと過去の更新の記録がすべて消え、閲覧URLも使えなくなります。元に戻せません。</span>
            <button class="danger" onClick={() => run(async () => { await api.remove(id, session); onDeleted(); })}>削除する</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : <button class="danger" onClick={() => setConfirm('delete')}>この曲メモを削除</button>}
      </div>
      {error && <p class="error">{error}</p>}
    </section>
  );
}

// 保存してあるキーを伏せて表示し、「表示」「コピー」できるようにする
function KeyView({ value }: { value?: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState('');
  if (!value) return <span class="sub">このブラウザには保存されていません。作成時に控えたキーは、引き続き使えます（再発行すると、このブラウザで見られます）。</span>;
  return (
    <>
      <code>{shown ? value : `${value.slice(0, 4)}${'•'.repeat(12)}`}</code>
      <button class="small" onClick={() => setShown(!shown)}>{shown ? '隠す' : '表示'}</button>
      <button class="small" onClick={async () => setCopied((await copy(value)) ? 'key' : '')}>{copied === 'key' ? 'コピー済み' : 'コピー'}</button>
    </>
  );
}

// 控えてあるキーを入れて、このブラウザに保存する（キーを保存する機能より前に作った曲メモや、別の端末で発行したキー向け）
function StoreKey({ id, role, note, onStored }: { id: string; role: 'admin' | 'edit'; note: string; onStored: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  if (!open) return <><span class="sub">{note}</span><button class="small" onClick={() => setOpen(true)}>控えてある{role === 'admin' ? '管理' : '編集'}キーを入れる</button></>;
  return (
    <form class="store-key" onSubmit={async (e) => {
      e.preventDefault();
      setError('');
      const k = key.trim().toLowerCase();
      try {
        // 正しいキーか、どちらのキーかをサーバーで確かめてから保存する
        const r = await api.session(id, k);
        if (r.role !== role) { setError(role === 'admin' ? 'これは編集キーです。管理キーを入れてください' : 'これは管理キーです。編集キーを入れてください'); return; }
        L.setKeys(id, { [role]: k });
        onStored();
      } catch (err) {
        setError(err instanceof Error ? err.message : '確認できませんでした');
      }
    }}>
      <input value={key} autoComplete="off" spellcheck={false} placeholder="48桁の英数字" onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
      <button class="small primary" type="submit" disabled={!key.trim()}>このブラウザに保存</button>
      <button class="small" type="button" onClick={() => setOpen(false)}>キャンセル</button>
      {error && <p class="error">{error}</p>}
    </form>
  );
}
