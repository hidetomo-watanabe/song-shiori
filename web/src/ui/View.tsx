import { useEffect, useRef, useState } from 'preact/hooks';
import { CHANGE_LABEL, diffSongs, type SongDiff } from '../../../shared/diff';
import { bpmOf, youtubeUrl } from '../../../shared/song';
import { YouTubePlayer } from '../audio/youtube';
import { api, track, type ViewData } from '../api';
import { ExportText } from './ExportText';
import { SeekBar } from './SeekBar';
import { StartEdit } from './StartEdit';
import { getSeen, setSeen } from '../storage/local';
import { fmt, fmtDate, fmtDay, groupTone, timeSignature } from './util';

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

  // YouTube の動画。開いたときに表示する（読み込めなかったときは、押して読み込み直せるようにする）
  const ytHost = useRef<HTMLDivElement>(null);
  const [yt, setYt] = useState<YouTubePlayer | null>(null);
  const [ytState, setYtState] = useState<'off' | 'loading' | 'ready'>('loading');
  const [ytError, setYtError] = useState('');
  const [now, setNow] = useState(0); // 再生位置（構成表の時刻）
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false); // 一度でも再生したか。再生前はどの区間も示さない
  useEffect(() => {
    if (ytState !== 'loading' || !data?.song.youtube || !ytHost.current) return;
    let alive = true;
    YouTubePlayer.create(ytHost.current, data.song.youtube).then((p) => {
      if (!alive) { p.destroy(); return; }
      p.onError = setYtError;
      p.offset = data.song.youtubeOffset ?? 0;
      // 表示しただけでは数えず、最初に再生したときに数える
      p.onPlay = () => { track('youtube_view_play'); p.onPlay = () => {}; };
      setYt(p);
      setYtState('ready');
    }).catch((e) => { if (alive) { setYtError(e instanceof Error ? e.message : '動画を読み込めませんでした'); setYtState('off'); } });
    return () => { alive = false; };
  }, [ytState, !!data]);
  useEffect(() => {
    if (!yt) return;
    const t = setInterval(() => {
      setNow(yt.currentTime);
      setPlaying(yt.playing);
      if (yt.playing) setStarted(true);
    }, 200);
    return () => { clearInterval(t); yt.destroy(); };
  }, [yt]);

  if (error) return <main class="page narrow"><p class="error">{error}</p></main>;
  if (!data) return <main class="page narrow"><p>読み込んでいます…</p></main>;

  const { song } = data;
  const current = started ? song.sections.find((s) => now >= s.start && now < s.end) ?? null : null;
  const diff: SongDiff | null = data.base ? diffSongs(data.base.song, song) : null;
  const bpm = bpmOf(song);
  // 同じ繰り返しの1回目の区間名。名前が違うのに同じ演奏の区間（大サビなど）に「〇〇と同じ」と添える
  const firstName = new Map<string, { id: string; name: string }>();
  for (const s of song.sections) if (s.group && !firstName.has(s.group)) firstName.set(s.group, { id: s.id, name: s.name });
  const sameAs = (s: (typeof song.sections)[number]) => {
    const f = s.group ? firstName.get(s.group) : null;
    return f && f.id !== s.id && !s.name.startsWith(f.name) ? f.name : null;
  };

  return (
    <main class="page view">
      <nav class="bar">
        <a href="#/" class="home"><img src="./favicon.svg" alt="" />曲のしおり</a>
        <span class="state" />
        <a class="button small new-link" href="#/" target="_blank" rel="noopener" title="新しいタブで開きます">＋ 新しく作る</a>
      </nav>
      <header class="view-head">
        <h1>{song.title || '曲名未入力'}</h1>
        {song.artist && <p class="artist">{song.artist}</p>}
        <div class="view-meta">
          <span class="tag">{bpm ? `BPM ${bpm}${song.bpmManual == null ? '（推定）' : ''}` : 'BPM 未確定'}</span>
          <span class="tag">{timeSignature(song.beatsPerBar)}</span>
          {song.firstDownbeat != null && <span class="tag">最初の小節頭 {fmt(song.firstDownbeat, 2)}</span>}
        </div>
        <p class="sub">最終更新 {fmtDate(data.updatedAt)}</p>
      </header>

      {diff?.changed && (
        <section class="card update" role="status">
          <h2>{seenBefore ? '前回見たあとに更新があります' : '前回の更新からの変更'}</h2>
          {data.notes.map((n) => <p key={n.version} class="note">・{n.note}</p>)}
          {diff.song.length > 0 && <p>曲全体：{diff.song.join('・')}を変更</p>}
          {diff.removed.map((s) => <p key={s.id}>削除：{s.name}（{fmt(s.start, 0)}〜{fmt(s.end, 0)}）</p>)}
          <p class="sub">変更のあった区間に印を付けています。</p>
        </section>
      )}

      {song.youtube && (
        <section class="card yt-view">
          {ytState === 'off' ? (
            <div class="yt-start">
              <button class="primary" onClick={() => { setYtError(''); setYtState('loading'); }}>▶ YouTube の動画を読み込み直す</button>
              <a class="sub" href={youtubeUrl(song.youtube)} target="_blank" rel="noopener">YouTube で開く</a>
            </div>
          ) : (
            <>
              <div class="yt-frame"><div ref={ytHost} /></div>
              {ytState === 'ready' && yt && (
                <>
                  <div class="view-player">
                    <button class={`small${playing ? ' on' : ''}`} aria-label={playing ? '一時停止' : '再生'}
                      onClick={() => { if (yt.playing) yt.pause(); else yt.play(); setPlaying(yt.playing); }}>{playing ? '■ 停止' : '▶ 再生'}</button>
                    <SeekBar now={now} duration={yt.duration} onSeek={(t) => { yt.seek(t); setNow(t); setStarted(true); }} />
                  </div>
                  <p class="sub">{current ? <><span class={`chip tone-${groupTone(current.group)}`} aria-hidden="true" />{current.name}・</> : null}表の区間を押すと、そこから再生します。</p>
                </>
              )}
            </>
          )}
          {ytError && <p class="error">{ytError}</p>}
        </section>
      )}

      <section class="card">
        <table class={`structure${yt ? ' playable' : ''}`}>
          <thead><tr><th>開始</th><th>終了</th><th>セクション</th><th class="num">小節数</th><th>メモ</th></tr></thead>
          <tbody>
            {song.sections.map((s) => {
              const changes = diff?.sections[s.id] ?? [];
              return (
                <tr key={s.id} class={`tone-${groupTone(s.group)}${changes.length ? ' changed' : ''}${s.silence ? ' silence' : ''}${current?.id === s.id ? ' now' : ''}`}
                  onClick={yt ? () => yt.play(s.start) : undefined}>
                  <td data-label="開始">
                    {yt && <button class="tiny ghost row-go" aria-label={`${s.name}から再生`} onClick={(e) => { e.stopPropagation(); yt.play(s.start); }}>▶</button>}
                    {fmt(s.start, 0)}
                  </td>
                  <td data-label="終了">{fmt(s.end, 0)}</td>
                  <td data-label="セクション">
                    <span class="chip" aria-hidden="true" />
                    {s.name}
                    {sameAs(s) && <span class="group">（{sameAs(s)}と同じ）</span>}
                    {changes.map((c) => <span key={c} class="tag change">{CHANGE_LABEL[c]}</span>)}
                  </td>
                  <td data-label="小節数" class="num">{s.silence ? '—' : s.barsManual ?? s.barsEst ?? '未確定'}</td>
                  <td data-label="メモ">{s.memo}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ExportText song={song} />
      </section>

      {song.memo && (
        <section class="card">
          <h2>全体メモ</h2>
          <p class="pre">{song.memo}</p>
        </section>
      )}
      <div class="view-foot">
        <StartEdit viewId={viewId} title={song.title} />
        <p class="sub">この構成メモは {fmtDay(data.expiresAt)} まで保管されます。</p>
      </div>
    </main>
  );
}
