import { useState } from 'preact/hooks';
import { api, randomHex, type MemoInfo } from '../api';
import { copy, fmtDay, viewUrl } from './util';

type Props = {
  id: string;
  meta: MemoInfo;
  session: string;
  onMeta: (m: MemoInfo) => void;
  onSession: (s: string) => void;
  onDeleted: () => void;
};

// 共有URL・編集キー・管理キー・保持期限・削除の管理（要件定義書 5.4）。管理キーで開いているときだけ表示する
export function Manage({ id, meta, session, onMeta, onSession, onDeleted }: Props) {
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState('');
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
        <div class="actions">
          {confirm === 'reshare' ? (
            <>
              <span>今の閲覧URLは使えなくなります。</span>
              <button class="danger" onClick={() => run(async () => onMeta(await api.reshare(id, session)))}>新しいURLを発行</button>
              <button onClick={() => setConfirm('')}>やめる</button>
            </>
          ) : <button onClick={() => setConfirm('reshare')}>閲覧URLを再発行</button>}
          {url && (confirm === 'unshare' ? (
            <>
              <span>閲覧URLで見られなくなります。</span>
              <button class="danger" onClick={() => run(async () => onMeta(await api.unshare(id, session)))}>共有を無効にする</button>
              <button onClick={() => setConfirm('')}>やめる</button>
            </>
          ) : <button onClick={() => setConfirm('unshare')}>共有を無効にする</button>)}
        </div>
      </div>

      <div class="manage-row">
        <h3>編集キー（メンバー用）</h3>
        <p class="sub">メンバーが閲覧ページの「編集する」で入れると、構成を直して保存できます。削除や共有の管理はできません。</p>
        {newEditKey ? (
          <>
            <p class="warn">新しい編集キーです。古い編集キーと、それで編集していた端末は使えなくなりました。メンバーに送り直してください。</p>
            <div class="copy-row"><code>{newEditKey}</code><button onClick={() => void copy(newEditKey)}>コピー</button></div>
          </>
        ) : confirm === 'editkey' ? (
          <div class="actions">
            <span>{meta.editKey ? '古い編集キーと、それで編集していた端末が使えなくなります。' : 'メンバーに渡す編集キーを発行します。'}</span>
            <button class={meta.editKey ? 'danger' : 'primary'} onClick={() => run(async () => {
              const key = randomHex(24);
              onMeta(await api.editKey(id, session, key));
              setNewEditKey(key);
            })}>{meta.editKey ? '再発行する' : '発行する'}</button>
            <button onClick={() => setConfirm('')}>やめる</button>
          </div>
        ) : confirm === 'stopedit' ? (
          <div class="actions">
            <span>編集キーが使えなくなり、メンバーは編集できなくなります（閲覧はできます）。</span>
            <button class="danger" onClick={() => run(async () => onMeta(await api.stopEdit(id, session)))}>メンバーの編集を止める</button>
            <button onClick={() => setConfirm('')}>やめる</button>
          </div>
        ) : (
          <div class="actions">
            <span>{meta.editKey ? '発行済み' : '未発行（メンバーは編集できません）'}</span>
            <button onClick={() => setConfirm('editkey')}>{meta.editKey ? '編集キーを再発行' : '編集キーを発行'}</button>
            {meta.editKey && <button class="danger" onClick={() => setConfirm('stopedit')}>メンバーの編集を止める</button>}
          </div>
        )}
      </div>

      <div class="manage-row">
        <h3>管理キー（作成者用）</h3>
        {newKey ? (
          <>
            <p class="warn">新しい管理キーです。古い管理キーと、それで編集していたほかの端末は使えなくなりました。<strong>なくすと復旧できません。</strong></p>
            <div class="copy-row"><code>{newKey}</code><button onClick={() => void copy(newKey)}>コピー</button></div>
          </>
        ) : confirm === 'rekey' ? (
          <div class="actions">
            <span>古い管理キーと、それで編集していたほかの端末が使えなくなります（編集キーはそのまま使えます）。</span>
            <button class="danger" onClick={() => run(async () => {
              const key = randomHex(24);
              const r = await api.rekey(id, session, key);
              onSession(r.session);
              setNewKey(key);
            })}>再発行する</button>
            <button onClick={() => setConfirm('')}>やめる</button>
          </div>
        ) : <button onClick={() => setConfirm('rekey')}>管理キーを再発行</button>}
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
            <span>構成メモと過去の版をすべて削除します。元に戻せません。</span>
            <button class="danger" onClick={() => run(async () => { await api.remove(id, session); onDeleted(); })}>削除する</button>
            <button onClick={() => setConfirm('')}>やめる</button>
          </div>
        ) : <button class="danger" onClick={() => setConfirm('delete')}>この曲メモを削除</button>}
      </div>
      {error && <p class="error">{error}</p>}
    </section>
  );
}
