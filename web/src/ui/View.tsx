import { useEffect, useRef, useState } from 'preact/hooks';
import { CHANGE_LABEL, diffSongs, type SongDiff } from '../../../shared/diff';
import { bpmOf, chordChartSite, chordChartUrl, chordsDifferFromFirst, confirmedChords, keySummary, sectionAt, transposeChords, transposeKey, trimSilence, youtubeUrl } from '../../../shared/song';
import { YouTubePlayer } from '../audio/youtube';
import { api, track, type ViewData } from '../api';
import { ExportText } from './ExportText';
import { SeekBar } from './SeekBar';
import { StartEdit } from './StartEdit';
import { getSeen, setSeen } from '../storage/local';
import { errorText, fmt, fmtDate, fmtDay, groupTone, shareMessage, timeSignature, viewUrl } from './util';
import { ShareButtons } from './ShareButtons';

// 共有閲覧ページ：構成表とメモの表示のみ（再生機能なし）。前に見た版からの変更を示す
export function View({ viewId }: { viewId: string }) {
  const [data, setData] = useState<ViewData | null>(null);
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  const [originalKeyChords, setOriginalKeyChords] = useState(false); // コード進行を原曲のキーで見る（既定は演奏するキー）
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
    }).catch((e) => setError(errorText(e, '読み込めませんでした')));
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
      // 以前の形式（無音の区間）を直すと YouTube のずれも変わるため、直した曲のずれを使う
      p.offset = trimSilence(data.song).youtubeOffset ?? 0;
      // 表示しただけでは数えず、最初に再生したときに数える
      p.onPlay = () => { track('youtube_view_play'); p.onPlay = () => {}; };
      setYt(p);
      setYtState('ready');
    }).catch((e) => { if (alive) { setYtError(errorText(e, '動画を読み込めませんでした')); setYtState('off'); } });
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

  // タブ・ブックマークの名前を曲名にする
  useEffect(() => {
    if (!data) return;
    const before = document.title;
    document.title = `${data.song.title || '曲名未入力'}｜曲のしおり`;
    return () => { document.title = before; };
  }, [data?.song.title]);

  // 共有の文（曲名・アーティスト・閲覧 URL）。コピー・LINE で送るで同じ文を使う
  const shareText = () => (data ? shareMessage(data.song.title, data.song.artist, viewUrl(viewId)) : '');

  if (error) return <main class="page narrow"><p class="error">{error}</p></main>;
  if (!data) return <main class="page narrow"><p>読み込んでいます…</p></main>;

  // 以前の形式（無音の区間）は、曲の頭を 0:00 にした形に直して表示する
  const song = trimSilence(data.song);
  const current = started ? sectionAt(song, now) ?? null : null;
  const diff: SongDiff | null = data.base ? diffSongs(data.base.song, song) : null;
  // 手で入れたコード進行がある区間が1つでもあれば、表にコードの列を出す（推定は閲覧ページに出さない）
  const hasChords = song.sections.some((s) => confirmedChords(song, s));
  // 演奏するキーへの移調。コード進行は原曲のキーで持っているので、表示するときに直す
  const shift = song.transpose ?? 0;
  const playKey = song.originalKey && shift ? transposeKey(song.originalKey, shift) : song.originalKey ?? null;
  const showChords = (text: string) => (shift && !originalKeyChords ? transposeChords(text, shift, playKey) : text);
  const key = keySummary(song);
  // 原曲と違うところ（カット・違う点のメモ）の数
  const arranged = song.sections.filter((s) => s.cut || s.arrange?.trim()).length;
  const bpm = bpmOf(song);
  // 同じ繰り返しの1回目の区間名。名前が違うのに同じ演奏の区間（大サビなど）に「〇〇と同じ」と添える
  const firstName = new Map<string, { id: string; name: string }>();
  for (const s of song.sections) if (s.group && !firstName.has(s.group)) firstName.set(s.group, { id: s.id, name: s.name });
  // 「（2回目）」などを除いた名前。自動で付く「Aメロ（1回目）」「Aメロ（2回目）」は同じ名前として扱う
  const baseName = (n: string) => n.replace(/[（(]\d+回目[）)]$/, '').trim();
  const sameAs = (s: (typeof song.sections)[number]) => {
    const f = s.group ? firstName.get(s.group) : null;
    return f && f.id !== s.id && !baseName(s.name).startsWith(baseName(f.name)) ? baseName(f.name) : null;
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
          {key && <span class="tag">{key}</span>}
          {shift !== 0 && hasChords && (
            <button class="small" onClick={() => setOriginalKeyChords(!originalKeyChords)}>
              {originalKeyChords ? 'コードを演奏するキーで見る' : 'コードを原曲のキーで見る'}
            </button>
          )}
        </div>
        {/* 編集する人が選んだコード譜のページ（U-FRET など）。全部のコードはそちらで見てもらう */}
        {song.chordChartUrl && chordChartUrl(song.chordChartUrl) && (
          <p class="chart-link">
            <a href={chordChartUrl(song.chordChartUrl)!} target="_blank" rel="noopener noreferrer">
              {chordChartSite(song.chordChartUrl)} でコード譜を見る<span aria-hidden="true"> ↗</span><span class="sr-only">（新しいタブで開きます）</span>
            </a>
          </p>
        )}
        {/* カバーでいちばん起きやすい勘違いは「原曲どおりだと思っていた」なので、冒頭で知らせる */}
        {arranged > 0 && <p class="arranged">原曲と違うところが {arranged} か所あります（表の「カット」「原曲と違う」の印）。</p>}
        <p class="sub">最終更新 {fmtDate(data.updatedAt)}</p>
        {/* 前回の版からの変更は1行で示し、区間ごとの変更は表の印で示す */}
        {diff?.changed && (
          <p class="sub update-line" role="status">
            {seenBefore ? '前回見たあとの変更' : '前回からの変更'}：{[
              ...data.notes.map((n) => n.note),
              ...(diff.song.length ? [`曲全体の${diff.song.join('・')}`] : []),
              ...diff.removed.map((x) => `${x.name}（${fmt(x.start, 0)}〜）を削除`),
              ...(Object.values(diff.sections).some((c) => c.length) ? ['区間の変更（表に印）'] : []),
            ].join('、')}
          </p>
        )}
      </header>

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
          <thead><tr><th>時刻</th><th>セクション</th><th class="num">小節数</th>{hasChords && <th>コード</th>}<th>メモ</th></tr></thead>
          <tbody>
            {song.sections.map((s) => {
              const changes = diff?.sections[s.id] ?? [];
              return (
                <tr key={s.id} class={`tone-${groupTone(s.group)}${changes.length ? ' changed' : ''}${s.cut ? ' cut' : ''}${current?.id === s.id ? ' now' : ''}`}
                  onClick={yt ? () => yt.play(s.start) : undefined}>
                  {/* 終わりは次の区間の始まりと同じなので、1つの列にまとめる */}
                  <td data-label="時刻">
                    {yt && <button class="tiny ghost row-go" aria-label={`${s.name}から再生`} onClick={(e) => { e.stopPropagation(); yt.play(s.start); }}>▶</button>}
                    {fmt(s.start, 0)}〜{fmt(s.end, 0)}
                  </td>
                  <td data-label="セクション">
                    <span class="chip" aria-hidden="true" />
                    {s.name}
                    {sameAs(s) && <span class="group">（{sameAs(s)}と同じ）</span>}
                    {s.cut && <span class="tag">カット（演奏しない）</span>}
                    {s.arrange?.trim() && <span class="tag warn arrange">原曲と違う：{s.arrange}</span>}
                    {changes.map((c) => <span key={c} class="tag change">{CHANGE_LABEL[c]}</span>)}
                    {yt && (
                      // 区間の中の再生位置。行を押したときの「区間の頭から再生」にならないよう、操作を行へ伝えない
                      <div class="row-seek" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                        <SeekBar compact range={{ start: s.start, end: s.end }} now={started ? now : -1} label={`${s.name}の再生位置`}
                          onSeek={(t) => { yt.seek(t); setNow(t); setStarted(true); }} />
                      </div>
                    )}
                  </td>
                  <td data-label="小節数" class="num">{s.barsManual ?? s.barsEst ?? '未確定'}</td>
                  {hasChords && (() => {
                    const c = confirmedChords(song, s);
                    return <td data-label="コード" class="chords">{c && showChords(c.text)}{chordsDifferFromFirst(song, s) && <span class="tag warn">1回目と違う</span>}</td>;
                  })()}
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
      {/* 曲の内容（構成表・全体メモ）のあとに、共有と書き出しの操作をまとめる。PC はコピーだけ、スマホはコピーと LINE で送る */}
      <ShareButtons text={shareText} />
      <ExportText song={song} />
      <div class="view-foot">
        <StartEdit viewId={viewId} title={song.title} />
        <p class="sub">この構成メモは {fmtDay(data.expiresAt)} まで保管されます。</p>
      </div>
    </main>
  );
}
