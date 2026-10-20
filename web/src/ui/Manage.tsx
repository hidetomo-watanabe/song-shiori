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

// 共有URL・秘密キー・保持期限・削除の管理（要件定義書 5.4）
export function Manage({ id, meta, session, onMeta, onSession, onDeleted }: Props) {
  const [error, setError] = useState('');
  const [newKey, setNewKey] = useState('');
  const [confirm, setConfirm] = useState<'' | 'rekey' | 'unshare' | 'reshare' | 'delete'>('');
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
        <h3>秘密キー</h3>
        {newKey ? (
          <>
            <p class="warn">新しい秘密キーです。古いキーと、ほかの端末の編集権限は使えなくなりました。<strong>なくすと復旧できません。</strong></p>
            <div class="copy-row"><code>{newKey}</code><button onClick={() => void copy(newKey)}>コピー</button></div>
          </>
        ) : confirm === 'rekey' ? (
          <div class="actions">
            <span>古いキーと、ほかの端末の編集権限が使えなくなります。</span>
            <button class="danger" onClick={() => run(async () => {
              const key = randomHex(24);
              const r = await api.rekey(id, session, key);
              onSession(r.session);
              setNewKey(key);
            })}>再発行する</button>
            <button onClick={() => setConfirm('')}>やめる</button>
          </div>
        ) : <button onClick={() => setConfirm('rekey')}>秘密キーを再発行</button>}
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
