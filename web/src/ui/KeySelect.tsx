import * as M from '../../../shared/song';
import type { Song } from '../../../shared/song';

type KeyPatch = Partial<Pick<Song, 'originalKey' | 'transpose'>>;

// 演奏するキー。コード進行は原曲のキーで入れ、閲覧ページでは演奏するキーに移調して表示する
export function KeySelect({ song, onChange }: { song: Song; onChange: (patch: KeyPatch) => void }) {
  return (
    <div class="key-row">
      <label>原曲のキー
        <select value={song.originalKey ?? ''} onChange={(e) => onChange({ originalKey: (e.currentTarget as HTMLSelectElement).value || null })}>
          <option value="">未設定</option>
          {M.KEYS.map((k) => <option key={k} value={k}>{M.keyLabel(k)}</option>)}
        </select>
      </label>
      <label>演奏するキー
        <select value={song.transpose ?? 0} onChange={(e) => onChange({ transpose: Number((e.currentTarget as HTMLSelectElement).value) || undefined })}>
          {Array.from({ length: 13 }, (_, i) => i - 6).map((t) => (
            <option key={t} value={t}>{t === 0 ? '原曲どおり' : `${t > 0 ? '+' : ''}${t}`}{t !== 0 && song.originalKey ? `（${M.keyLabel(M.transposeKey(song.originalKey, t) ?? '')}）` : ''}</option>
          ))}
        </select>
      </label>
      {(song.transpose ?? 0) !== 0 && <span class="sub">コード進行は原曲のキーで入力してください。閲覧ページでは演奏するキーに直して表示します。</span>}
    </div>
  );
}
