import { useEffect, useState } from 'preact/hooks';
import { deriveEditKey } from '../../../shared/keys';
import { api, randomHex, type MemoInfo } from '../api';
import { CopyRow } from './CopyRow';
import { ShareButtons } from './ShareButtons';
import { editUrl, errorText, fmtDay, memberMessage, shareMessage, toast, viewUrl } from './util';

type Props = {
  id: string;
  title: string;
  artist: string;
  meta: MemoInfo;
  adminKey: string;
  onMeta: (m: MemoInfo) => void;
  onKey: (key: string) => void;
  onDeleted: () => void;
};

// 共有URL・編集リンク・管理リンク・保持期限・削除の管理（要件定義書 5.4）。管理リンクで開いているときだけ表示する
// 編集リンクは管理キーから導出するので、管理リンクを持つ端末ならどれでも出せる（ライブのしおりのメンバー用リンクと同じ）
export function Manage({ id, title, artist, meta, adminKey, onMeta, onKey, onDeleted }: Props) {
  const [error, setError] = useState('');
  const [editLink, setEditLink] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setEditLink(null);
    if (meta.editKeyGen) void deriveEditKey(adminKey, meta.editKeyGen).then((k) => { if (live) setEditLink(editUrl(id, k)); });
    return () => { live = false; };
  }, [adminKey, meta.editKeyGen]);
  const [confirm, setConfirm] = useState<'' | 'rekey' | 'editkey' | 'stopedit' | 'unshare' | 'reshare' | 'delete'>('');

  const run = async (fn: () => Promise<void>) => {
    setError('');
    try { await fn(); } catch (e) { setError(errorText(e, '操作できませんでした')); }
    setConfirm('');
  };

  const url = meta.viewId ? viewUrl(meta.viewId) : null;

  return (
    <section class="card manage">
      <h2>共有と管理</h2>
      <div class="manage-row">
        <h3>閲覧URL</h3>
        {url ? (
          <CopyRow value={url}>
            <a class="button" href={url} target="_blank" rel="noopener">開く</a>
          </CopyRow>
        ) : <p class="warn">共有は無効になっています。</p>}
        {/* 見てもらうだけのときは、曲名と閲覧 URL を送る（編集キーは入れない） */}
        {url && <ShareButtons text={() => shareMessage(title, artist, url)} />}
        <div class="actions">
          {confirm === 'reshare' ? (
            <>
              <span>再発行すると、今の閲覧URLは使えなくなります。メンバーに新しいURLを送り直してください。</span>
              <button class="danger" onClick={() => run(async () => onMeta(await api.reshare(id, adminKey)))}>新しいURLを発行</button>
              <button onClick={() => setConfirm('')}>キャンセル</button>
            </>
          ) : <button onClick={() => setConfirm('reshare')}>閲覧URLを再発行</button>}
          {url && (confirm === 'unshare' ? (
            <>
              <span>無効にすると、閲覧URLで見られなくなります（あとで新しいURLを発行できます）。</span>
              <button class="danger" onClick={() => run(async () => onMeta(await api.unshare(id, adminKey)))}>共有を無効にする</button>
              <button onClick={() => setConfirm('')}>キャンセル</button>
            </>
          ) : <button onClick={() => setConfirm('unshare')}>共有を無効にする</button>)}
        </div>
      </div>

      <div class="manage-row">
        <h3>編集リンク（一緒に直すメンバー用）</h3>
        <p class="sub">開いた人は、構成を直して保存できます。削除や共有の管理はできません。</p>
        {confirm === 'editkey' ? (
          <div class="actions">
            <span>{meta.editKey ? '作り直すと、今の編集リンクは使えなくなります。新しいリンクをメンバーに送り直してください。' : 'メンバーに送る編集リンクを作ります。'}</span>
            <button class={meta.editKey ? 'danger' : 'primary'} onClick={() => run(async () => {
              onMeta(await api.editKey(id, adminKey));
              toast(meta.editKey ? '編集リンクを作り直しました。新しいリンクをメンバーに送り直してください。' : '編集リンクを作りました。');
            })}>{meta.editKey ? '作り直す' : '作る'}</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : confirm === 'stopedit' ? (
          <div class="actions">
            <span>止めると、編集リンクが使えなくなり、メンバーは編集できなくなります（閲覧はできます）。</span>
            <button class="danger" onClick={() => run(async () => onMeta(await api.stopEdit(id, adminKey)))}>メンバーの編集を止める</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : (
          <>
            {editLink ? <CopyRow value={editLink} />
              : meta.editKey ? <p class="sub">以前の形式の編集キーです（受け取ったメンバーは引き続き使えます）。作り直すと、ここに編集リンクを出せるようになります。</p>
              : <p class="sub">未発行（メンバーは編集できません）</p>}
            {/* 編集もしてほしいメンバーには、閲覧 URL と編集リンクを送る */}
            {editLink && <ShareButtons text={() => memberMessage(title, artist, url, editLink)} copyLabel="メンバーに送る文をコピー" copied={url ? '閲覧URLと編集リンクをコピーしました。' : '編集リンクをコピーしました。'} />}
            <div class="actions">
              <button onClick={() => setConfirm('editkey')}>{meta.editKey ? '編集リンクを作り直す' : '編集リンクを作る'}</button>
              {meta.editKey && <button class="danger" onClick={() => setConfirm('stopedit')}>メンバーの編集を止める</button>}
            </div>
          </>
        )}
      </div>

      <div class="manage-row">
        <h3>管理リンク（あなた用）</h3>
        <p class="sub">削除・共有の管理・リンクの作り直しができます。メンバーには送らないでください。自分の別の端末では、<a href="#/mine">マイキー</a>を使うと、この曲メモも含めて端末どうしで揃います。</p>
        {confirm === 'rekey' ? (
          <div class="actions">
            <span>作り直すと、今の管理リンクと編集リンクは両方とも使えなくなります（このブラウザと、同じマイキーの端末はそのまま使えます）。メンバーには新しい編集リンクを送り直してください。</span>
            <button class="danger" onClick={() => run(async () => {
              const key = randomHex(24);
              onMeta(await api.rekey(id, adminKey, key));
              onKey(key);
              toast('管理リンクと編集リンクを作り直しました。メンバーには新しい編集リンクを送り直してください。');
            })}>作り直す</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : (
          <>
            <CopyRow value={editUrl(id, adminKey)} />
            <div class="actions">
              <button onClick={() => setConfirm('rekey')}>管理リンクを作り直す</button>
            </div>
          </>
        )}
      </div>

      <div class="manage-row">
        <h3>保持期限</h3>
        <p>{fmtDay(meta.expiresAt)} まで（最後の保存から180日。閲覧だけでは延びません）</p>
        <button onClick={() => run(async () => onMeta(await api.extend(id, adminKey)))}>今日から180日に延長</button>
      </div>

      <div class="manage-row">
        <h3>削除</h3>
        {confirm === 'delete' ? (
          <div class="actions">
            <span>削除すると、構成メモと過去の更新の記録がすべて消え、閲覧URLも使えなくなります。元に戻せません。</span>
            <button class="danger" onClick={() => run(async () => { await api.remove(id, adminKey); onDeleted(); })}>削除する</button>
            <button onClick={() => setConfirm('')}>キャンセル</button>
          </div>
        ) : <button class="danger" onClick={() => setConfirm('delete')}>この曲メモを削除</button>}
      </div>
      {error && <p class="error">{error}</p>}
    </section>
  );
}
