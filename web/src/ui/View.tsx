import { useEffect, useState } from 'preact/hooks';
import { CHANGE_LABEL, diffSongs, type SongDiff } from '../../../shared/diff';
import { bpmOf } from '../../../shared/song';
import { api, track, type ViewData } from '../api';
import { getSeen, setSeen } from '../storage/local';
import { fmt, fmtDate, fmtDay, groupTone } from './util';

// 共有閲覧ページ：構成表とメモの表示のみ（再生機能なし）。前に見た版からの変更を示す
export function View({ viewId }: { viewId: string }) {
  const [data, setData] = useState<ViewData | null>(null);
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  const [error, setError] = useState('');

  // 閲覧ページは限定共有のため、検索エンジンに登録させない
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    const seen = getSeen(viewId);
    setSeenBefore(seen);
    api.view(viewId, seen).then((d) => {
      setData(d);
      if (seen && d.base) track('view_after_update');
      setSeen(viewId, d.version);
    }).catch((e) => setError(e instanceof Error ? e.message : '読み込めませんでした'));
  }, []);

  if (error) return <main class="page narrow"><p class="error">{error}</p></main>;
  if (!data) return <main class="page narrow"><p>読み込んでいます…</p></main>;

  const { song } = data;
  const diff: SongDiff | null = data.base ? diffSongs(data.base.song, song) : null;
  const bpm = bpmOf(song);

  return (
    <main class="page view">
      <header class="view-head">
        <h1>{song.title || '曲名未入力'}</h1>
        {song.artist && <p class="artist">{song.artist}</p>}
        <p class="sub">最終更新 {fmtDate(data.updatedAt)}・版 {data.version}</p>
      </header>

      {diff?.changed && (
        <section class="card update" role="status">
          <h2>{seenBefore ? '前回見たあとに更新があります' : `直前の版（版 ${data.base!.version}）からの変更`}</h2>
          {data.notes.map((n) => <p key={n.version} class="note">版 {n.version}：{n.note}</p>)}
          {diff.song.length > 0 && <p>曲全体：{diff.song.join('・')}を変更</p>}
          {diff.removed.map((s) => <p key={s.id}>削除：{s.name}（{fmt(s.start, 0)}〜{fmt(s.end, 0)}）</p>)}
          <p class="sub">変更のあった区間に印を付けています。</p>
        </section>
      )}

      <section class="card">
        <p class="tempo-line">
          {bpm ? `BPM ${bpm}${song.bpmManual == null ? '（推定）' : ''}` : 'BPM 未確定'}・{song.beatsPerBar}拍子
          {song.firstDownbeat != null && `・最初の小節頭 ${fmt(song.firstDownbeat, 2)}`}
        </p>
        <table class="structure">
          <thead><tr><th>開始</th><th>終了</th><th>セクション</th><th class="num">小節数</th><th>メモ</th></tr></thead>
          <tbody>
            {song.sections.map((s) => {
              const changes = diff?.sections[s.id] ?? [];
              return (
                <tr key={s.id} class={`tone-${groupTone(s.group)}${changes.length ? ' changed' : ''}`}>
                  <td data-label="開始">{fmt(s.start, 0)}</td>
                  <td data-label="終了">{fmt(s.end, 0)}</td>
                  <td data-label="セクション">
                    <span class="chip" aria-hidden="true" />
                    {s.name}
                    {s.group && <span class="group">（グループ{s.group}）</span>}
                    {changes.map((c) => <span key={c} class="tag change">{CHANGE_LABEL[c]}</span>)}
                  </td>
                  <td data-label="小節数" class="num">{s.barsManual ?? s.barsEst ?? '未確定'}</td>
                  <td data-label="メモ">{s.memo}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {song.memo && (
        <section class="card">
          <h2>全体メモ</h2>
          <p class="pre">{song.memo}</p>
        </section>
      )}
      <p class="sub center">この構成メモは {fmtDay(data.expiresAt)} まで保管されます。</p>
    </main>
  );
}
