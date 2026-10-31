import { CopyRow } from './CopyRow';
import { ShareButtons } from './ShareButtons';
import { editUrl, memberMessage, shareMessage, viewUrl, type Created } from './util';

// 初めて保存したときに、閲覧URL・編集リンク・管理リンクを案内する。リンクのキーはこのブラウザに保存済み（あとから「共有と管理」でも出せる）
export function CreatedDialog({ info, onClose }: { info: Created; onClose: () => void }) {
  const url = viewUrl(info.viewId);
  const edit = editUrl(info.id, info.editKey);
  return (
    <div class="dialog-back">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="created-title">
        <h2 id="created-title">保存しました</h2>
        <h3>閲覧URL（メンバーに共有）</h3>
        <p class="sub">URLを知っている人は構成表を見られます。</p>
        <CopyRow value={url} />
        <ShareButtons text={() => shareMessage(info.title, info.artist, url)} />
        <h3>編集リンク（一緒に直すメンバーに共有）</h3>
        <p class="sub">開くと、構成を直して保存できます。削除や共有の管理はできません。</p>
        <CopyRow value={edit} />
        <ShareButtons text={() => memberMessage(info.title, info.artist, url, edit)} copyLabel="メンバーに送る文をコピー" copied="閲覧URLと編集リンクをコピーしました。" />
        <h3>管理リンク（あなた用）</h3>
        <p class="warn">削除・共有の管理・リンクの作り直しができます。このブラウザに保存してあり、「共有と管理」からいつでも出せます。<strong>メンバーには送らないでください。</strong>自分の別の端末で使うときは、<a href="#/mine" target="_blank" rel="noopener">マイキー</a>を使うと端末どうしで揃います。</p>
        <CopyRow value={editUrl(info.id, info.key)} />
        <div class="dialog-foot">
          <button class="primary" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}
