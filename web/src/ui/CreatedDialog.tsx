import { CopyRow } from './CopyRow';
import { ShareButtons } from './ShareButtons';
import { memberMessage, shareMessage, viewUrl, type Created } from './util';

// 初めて保存したときに、閲覧URL・編集キー・管理キーを控えてもらう
export function CreatedDialog({ info, onRemember, onClose }: { info: Created; onRemember: (r: boolean) => void; onClose: () => void }) {
  const url = viewUrl(info.viewId);
  return (
    <div class="dialog-back">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="created-title">
        <h2 id="created-title">保存しました</h2>
        <h3>閲覧URL（メンバーに共有）</h3>
        <p class="sub">URLを知っている人は構成表を見られます。</p>
        <CopyRow value={url} />
        <ShareButtons text={() => shareMessage(info.title, info.artist, url)} />
        <h3>編集キー（メンバーに共有）</h3>
        <p class="sub">閲覧ページの「編集する」で入れると、構成を直して保存できます。削除や共有の管理はできません。</p>
        <CopyRow value={info.editKey} />
        <ShareButtons text={() => memberMessage(info.title, info.artist, url, info.editKey)} copyLabel="メンバーに送る文をコピー" copied="閲覧URLと編集キーをコピーしました。" />
        <h3>管理キー（あなただけが控える）</h3>
        <p class="warn">削除・共有の管理・キーの再発行に必要です。アカウントがないため、<strong>なくすと復旧できません</strong>。メンバーには渡さず、安全な場所に控えてください。</p>
        <CopyRow value={info.key} />
        <div class="dialog-foot">
          <label class="check"><input type="checkbox" defaultChecked onChange={(e) => onRemember((e.currentTarget as HTMLInputElement).checked)} />このブラウザに編集権限を記憶する</label>
          <button class="primary" onClick={onClose}>控えました</button>
        </div>
      </div>
    </div>
  );
}
