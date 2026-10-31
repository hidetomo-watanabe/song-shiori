import { useEffect, useState } from 'preact/hooks';
import { api, type MemoStatus } from '../api';
import * as L from '../storage/local';
import { syncKeys } from '../storage/mykey';
import { fmtDate, fmtDay } from './util';

const SOON_DAYS = 30; // 削除予定日を出す、期限までの日数

// このブラウザ（マイキーを使っていれば同じマイキーの端末）で作った・リンクを開いた曲メモの一覧。
// マイキーを使っていれば先に同期し、それぞれがまだあるかをサーバーで確かめて曲名・更新日時を最新にする。確かめられなければ記録のまま出す
export function MineList({ empty, onSync }: { empty?: string; onSync?: (count: number | null, error: string) => void }) {
  const ids = () => [...new Set([...L.listMine().map((m) => m.id), ...L.keyIds()])];
  const entries = () => {
    const mine = new Map(L.listMine().map((m) => [m.id, m]));
    return ids().map((id) => mine.get(id) ?? { id, title: '', updatedAt: 0 });
  };
  const [mine, setMine] = useState(entries);
  const [status, setStatus] = useState(new Map<string, MemoStatus>());

  useEffect(() => {
    void (async () => {
      if (L.getMyKey()) {
        let count: number | null = null;
        let error = '';
        try { count = await syncKeys(); } catch (e) { error = e instanceof Error ? e.message : '同期できませんでした'; }
        onSync?.(count, error);
        setMine(entries());
      }
      const list = ids();
      if (!list.length) return;
      try {
        const { items } = await api.status(list.slice(0, 50).map((id) => ({ id, key: L.getKey(id) })));
        L.updateMine(new Map(items.flatMap((x) => (x.title != null && x.updatedAt != null ? [[x.id, { title: x.title, updatedAt: x.updatedAt, viewId: x.viewId }]] : []))));
        setMine(entries());
        setStatus(new Map(items.map((x) => [x.id, x])));
      } catch { /* 記録のまま出す */ }
    })();
  }, []);

  function forget(m: L.MineEntry, gone: boolean) {
    // 消えていない曲メモは、このブラウザのリンクのキーも消えるので確かめる（同じマイキーの端末からも消える）
    if (!gone && L.getKey(m.id) && !window.confirm(`「${m.title || '曲名未入力'}」を一覧から外します。このブラウザ${L.getMyKey() ? 'と同じマイキーの端末' : ''}からリンクも消えるため、編集するにはリンクを開き直す必要があります。よろしいですか？`)) return;
    L.forgetMine(m.id);
    L.setKey(m.id, null);
    setMine(entries());
  }

  if (!mine.length) return empty ? <p class="sub">{empty}</p> : null;
  return (
    <ul class="mine">
      {mine.map((m) => {
        const st = status.get(m.id);
        const soon = !st?.paid && st?.expiresAt != null && st.expiresAt - Date.now() < SOON_DAYS * 864e5;
        return (
          <li key={m.id}>
            {st?.gone ? (
              <div class="mine-gone">
                <b>{m.title || '曲名未入力'}</b>
                <span class="sub">見つかりません。削除されたか、保存期間が終わりました</span>
              </div>
            ) : (
              <a href={`#/e/${m.id}`}>{m.title || '曲名未入力'}</a>
            )}
            {!st?.gone && <span class="sub">{soon ? `${fmtDay(st!.expiresAt!)} に削除予定` : m.updatedAt ? fmtDate(m.updatedAt) : ''}</span>}
            <button class="small ghost" onClick={() => forget(m, !!st?.gone)}>一覧から外す</button>
          </li>
        );
      })}
    </ul>
  );
}
