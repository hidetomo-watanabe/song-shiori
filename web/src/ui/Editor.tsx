import { useEffect, useRef, useState } from 'preact/hooks';
import * as M from '../../../shared/song';
import type { AnalysisResult, Section, Song } from '../../../shared/song';
import { checkFile, MAX_SECONDS, Player } from '../audio/player';
import { runAnalysis, toAnalysisSamples, type AnalysisJob } from '../analysis/run';
import { api, ApiError, randomHex, track, type MemoInfo } from '../api';
import * as L from '../storage/local';
import { BpmLookup } from './BpmLookup';
import { SongLookup } from './SongLookup';
import { Manage } from './Manage';
import { Timeline } from './Timeline';
import { copy, fmt, go, groupTone, handoff, parseTime, viewUrl } from './util';

type Mode = { kind: 'draft'; manual: boolean } | { kind: 'saved'; id: string };

// 再生は画面をまたいで1つだけ。初回保存で編集画面に切り替わっても、選んだ音源を使い続ける
const player = new Player();
let playerFile = '';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function Editor({ mode }: { mode: Mode }) {
  const id = mode.kind === 'saved' ? mode.id : null;
  const draftKey = id ? `pending:${id}` : 'draft';

  // 構成データと「元に戻す」の履歴
  const [song, setSong] = useState<Song | null>(null);
  const songRef = useRef<Song | null>(null);
  const history = useRef<Song[]>([]);
  const coalesce = useRef<{ key: string; at: number } | null>(null);
  const [dirty, setDirty] = useState(false);

  // 保存済みメモの情報と権限
  const [meta, setMeta] = useState<MemoInfo | null>(null);
  const base = useRef<number | null>(null); // 編集の元になった版番号
  const createInfo = useRef<{ requestId: string; key: string } | null>(null);
  const [session, setSessionState] = useState<string | null>(id ? L.getSession(id) : null);
  const [needKey, setNeedKey] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [restore, setRestore] = useState<L.DraftRecord | null>(null);
  const [created, setCreated] = useState(handoff.created && handoff.created.id === id ? handoff.created : null);

  // 再生
  const [fileName, setFileName] = useState(() => {
    if (created) return playerFile;
    player.stop();
    player.buffer = null;
    player.loop = null;
    return '';
  });
  const [audioNote, setAudioNote] = useState('');
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopId, setLoopId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);

  // 解析
  const [progress, setProgress] = useState<{ ratio: number; stage: string } | null>(null);
  const job = useRef<AnalysisJob | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [proposal, setProposal] = useState<AnalysisResult | null>(null);
  const [notice, setNotice] = useState('');

  // 保存
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState<{ version: number } | null>(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);

  function init(s: Song) {
    songRef.current = s;
    history.current = [];
    setSong(s);
  }

  function edit(fn: (s: Song) => Song, opts: { history?: boolean; coalesce?: string } = {}) {
    const cur = songRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    const c = coalesce.current;
    const merge = opts.history === false || (opts.coalesce && c?.key === opts.coalesce && Date.now() - c.at < 1500);
    if (!merge) history.current = [...history.current.slice(-99), cur];
    coalesce.current = opts.coalesce ? { key: opts.coalesce, at: Date.now() } : null;
    songRef.current = next;
    setSong(next);
    setDirty(true);
    if (saveState === 'saved') setSaveState('idle');
  }

  function undo() {
    const prev = history.current.pop();
    if (!prev) return;
    coalesce.current = null;
    songRef.current = prev;
    setSong(prev);
    setDirty(true);
  }

  // 初期化：下書き・音源・保存済みメモを読み込む
  useEffect(() => {
    void (async () => {
      if (mode.kind === 'draft') {
        const file = handoff.file;
        handoff.file = null;
        if (file) {
          init(M.emptySong());
          await loadAudio(file, true);
          return;
        }
        const rec = await L.loadDraft('draft');
        if (rec) {
          createInfo.current = rec.create ?? null;
          init(rec.song);
          setDirty(true);
        } else {
          init(M.emptySong());
          if (mode.manual) track('manual_start');
        }
        return;
      }
      await loadSaved(session);
    })();
    return () => { job.current?.cancel(); player.pause(); player.loop = null; };
  }, []);

  async function loadSaved(token: string | null) {
    if (!id) return;
    if (!token) { setNeedKey(true); return; }
    try {
      const d = await api.get(id, token);
      setMeta(d);
      base.current = d.version;
      init(d.song);
      setDirty(false);
      setNeedKey(false);
      L.rememberMine({ id, title: d.song.title, updatedAt: d.updatedAt });
      const pending = await L.loadDraft(draftKey);
      if (pending) setRestore(pending);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        L.setSession(id, null, false);
        setSessionState(null);
        setNeedKey(true);
      } else setLoadError(e instanceof Error ? e.message : '読み込めませんでした');
    }
  }

  // 変更をブラウザ内に退避する（未保存の下書き・未送信の変更）
  useEffect(() => {
    if (!song || !dirty) return;
    const t = setTimeout(() => {
      void L.saveDraft(draftKey, { song, updatedAt: Date.now(), baseVersion: base.current ?? undefined, create: createInfo.current ?? undefined });
    }, 400);
    return () => clearTimeout(t);
  }, [song, dirty]);

  // 再生位置の表示
  useEffect(() => {
    const t = setInterval(() => { setNow(player.currentTime); setPlaying(player.playing); }, 100);
    return () => clearInterval(t);
  }, []);

  // 区間の境界が変わったらループ範囲も合わせる
  useEffect(() => {
    if (!loopId || !song) return;
    const s = song.sections.find((x) => x.id === loopId);
    if (!s) { setLoopId(null); player.setLoop(null); return; }
    if (player.loop?.start !== s.start || player.loop?.end !== s.end) player.setLoop({ start: s.start, end: s.end });
  }, [song, loopId]);

  // キーボード：スペースで再生・停止、Ctrl/⌘+Z で元に戻す（入力欄の中では使わない）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === ' ' && player.buffer) { e.preventDefault(); togglePlay(); }
      if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); undo(); }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  });

  async function loadAudio(file: File, analyzeNow: boolean) {
    setAudioNote('');
    setAnalysisError('');
    const err = await checkFile(file);
    if (err) { setAudioNote(err); return; }
    try {
      setProgress({ ratio: 0, stage: '音源を読み込んでいます' });
      const buf = await player.load(file);
      if (buf.duration > MAX_SECONDS) {
        player.stop();
        player.buffer = null;
        setProgress(null);
        setAudioNote('15分を超える音源には対応していません');
        return;
      }
      setFileName(file.name);
      playerFile = file.name;
      const cur = songRef.current!;
      if (!cur.sections.length && !analyzeNow) {
        edit((s) => M.normalize({ ...s, duration: buf.duration, sections: [M.newSection(0, buf.duration)] }));
      } else if (cur.sections.length && Math.abs(cur.duration - buf.duration) > 1) {
        setAudioNote(`構成表の長さ（${fmt(cur.duration)}）と音源の長さ（${fmt(buf.duration)}）が違います。別バージョンの音源かもしれません。`);
      }
      if (analyzeNow) await analyzeBuffer(buf, cur.sections.length ? 'propose' : 'replace');
      else setProgress(null);
    } catch (e) {
      setProgress(null);
      setAudioNote(e instanceof Error ? e.message : '音源を読み込めませんでした');
    }
  }

  async function analyzeBuffer(buf: AudioBuffer, how: 'replace' | 'propose') {
    setAnalysisError('');
    setProposal(null);
    setProgress({ ratio: 0, stage: '解析の準備をしています' });
    try {
      const samples = await toAnalysisSamples(buf);
      const j = runAnalysis(samples, (ratio, stage) => setProgress({ ratio, stage }));
      job.current = j;
      const { result, ms } = await j.promise;
      track('analysis_ok', { durationMs: Math.round(ms), audioSec: buf.duration });
      if (how === 'replace') {
        edit((s) => M.songFromAnalysis(result, s));
        setSelected(null);
      } else setProposal(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '解析に失敗しました';
      setAnalysisError(msg);
      if (msg !== '解析を中止しました') track('analysis_fail', { error: msg.slice(0, 60), audioSec: buf.duration });
      if (!songRef.current?.sections.length) {
        edit((s) => M.normalize({ ...s, duration: buf.duration, sections: [M.newSection(0, buf.duration)] }));
      }
    } finally {
      job.current = null;
      setProgress(null);
    }
  }

  function adopt() {
    if (!proposal) return;
    const r = M.adoptAnalysis(songRef.current!, proposal);
    edit(() => r.song);
    setNotice(r.sectionsReplaced ? '再解析の結果を採用しました。' : '手動で直した区間があるため、区間はそのままにして、テンポの推定値だけを更新しました。');
    setProposal(null);
  }

  // 再生操作（iPhone ではタップを起点にしないと音が出ない）
  function togglePlay() {
    if (player.playing) player.pause();
    else player.play();
    setPlaying(player.playing);
  }
  function playSection(s: Section) {
    if (loopId) { setLoopId(s.id); player.loop = { start: s.start, end: s.end }; }
    player.play(s.start);
    setSelected(s.id);
  }
  function toggleLoop(s: Section) {
    if (loopId === s.id) { setLoopId(null); player.setLoop(null); return; }
    setLoopId(s.id);
    player.setLoop({ start: s.start, end: s.end });
    if (!player.playing) player.play(s.start);
    track('loop_play');
  }

  const snapT = (t: number) => (snap && songRef.current ? M.snapToBeat(songRef.current, t) : t);

  async function save(force = false) {
    const s = songRef.current;
    if (!s) return;
    const err = M.validateSong(s);
    if (err) { setSaveState('error'); setSaveError(err); return; }
    setSaveState('saving');
    setSaveError('');
    try {
      if (!id) {
        createInfo.current ??= { requestId: randomHex(16), key: randomHex(24) };
        await L.saveDraft('draft', { song: s, updatedAt: Date.now(), create: createInfo.current });
        const c = await api.create(createInfo.current.requestId, createInfo.current.key, s);
        L.setSession(c.id, c.session, true);
        L.rememberMine({ id: c.id, title: s.title, updatedAt: c.updatedAt });
        await L.removeDraft('draft');
        handoff.created = { id: c.id, viewId: c.viewId!, key: createInfo.current.key };
        go(`#/e/${c.id}`, true);
        return;
      }
      const baseVersion = force && conflict ? conflict.version : base.current!;
      const r = await api.save(id, session!, baseVersion, s, note.trim(), notify);
      setMeta(r);
      base.current = r.version;
      setConflict(null);
      setDirty(false);
      setNote('');
      setNotify(true);
      setSaveState('saved');
      await L.removeDraft(draftKey);
      L.rememberMine({ id, title: s.title, updatedAt: r.updatedAt });
    } catch (e) {
      setSaveState('error');
      if (e instanceof ApiError && e.status === 409 && id) {
        setConflict({ version: e.body?.version });
        setSaveError('他の端末で更新されています。最新の版を読み込むか、この内容で上書きするかを選んでください。');
      } else if (e instanceof ApiError && e.status === 401) {
        setSaveError('編集の有効期限が切れました。秘密キーを入力すると、変更を保持したまま保存できます。');
        setSessionState(null);
        setNeedKey(true);
      } else setSaveError(`${e instanceof Error ? e.message : '保存できませんでした'}。変更はこの端末に残っています。`);
    }
  }

  async function reloadLatest() {
    await L.removeDraft(draftKey);
    setConflict(null);
    setSaveState('idle');
    setSaveError('');
    await loadSaved(session);
  }

  async function submitKey(key: string, remember: boolean) {
    if (!id) return;
    try {
      const { session: s } = await api.session(id, key.trim().toLowerCase());
      L.setSession(id, s, remember);
      setSessionState(s);
      if (songRef.current && dirty) { setNeedKey(false); setSaveState('idle'); setSaveError(''); return; }
      await loadSaved(s);
    } catch (e) {
      return e instanceof Error ? e.message : '確認できませんでした';
    }
  }

  // ---- 表示 ----
  if (loadError) return <main class="page narrow"><p class="error">{loadError}</p><a href="#/">トップへ</a></main>;
  if (needKey && !song) return <KeyForm onSubmit={submitKey} />;
  if (!song) return <main class="page narrow"><p>読み込んでいます…</p>{progress && <Progress p={progress} />}</main>;

  const groups = M.groupsOf(song);
  const bar = M.barSeconds(song);
  const beat = M.bpmOf(song) ? 60 / M.bpmOf(song)! : null;
  const step = snap && beat && M.hasGrid(song) ? beat : 0.1;
  const current = song.sections.find((s) => now >= s.start && now < s.end)?.id;
  const hasAudio = !!player.buffer;
  const totalBars = song.sections.reduce((p, s) => p + (s.barsManual ?? s.barsEst ?? 0), 0);

  return (
    <main class="page editor">
      <header class="bar">
        <a href="#/" class="home">曲のしおり</a>
        <span class="state">{id ? `版 ${meta?.version ?? '-'}` : '下書き（この端末にだけ保存）'}</span>
        <button onClick={undo} disabled={!history.current.length} title="元に戻す（Ctrl/⌘+Z）">元に戻す</button>
      </header>

      {created && (
        <CreatedDialog
          info={created}
          onRemember={(r) => { if (session && id) L.setSession(id, session, r); }}
          onClose={() => { handoff.created = null; setCreated(null); }}
        />
      )}

      {restore && (
        <section class="card notice">
          <p>この曲メモには、保存されていない変更がこの端末に残っています。{restore.baseVersion !== meta?.version && `（版 ${restore.baseVersion} を元にした変更です。保存すると競合として確認します）`}</p>
          <button class="primary" onClick={() => { base.current = restore.baseVersion ?? base.current; edit(() => restore.song); setRestore(null); }}>変更を復元する</button>
          <button onClick={() => { void L.removeDraft(draftKey); setRestore(null); }}>破棄する</button>
        </section>
      )}

      <section class="card song-info">
        <div class="row2">
          <label>曲名<input value={song.title} maxLength={200} onInput={(e) => edit((s) => ({ ...s, title: (e.currentTarget as HTMLInputElement).value }), { coalesce: 'title' })} /></label>
          <label>アーティスト<input value={song.artist} maxLength={200} onInput={(e) => edit((s) => ({ ...s, artist: (e.currentTarget as HTMLInputElement).value }), { coalesce: 'artist' })} /></label>
        </div>
        <SongLookup title={song.title} artist={song.artist} duration={player.buffer ? player.duration : null}
          onPick={(t) => edit((s) => ({ ...s, title: t.title, artist: t.artist }))} />
      </section>

      <section class="card player">
        <div class="player-row">
          <button class="primary play" onClick={togglePlay} disabled={!hasAudio}>{playing ? '一時停止' : '再生'}</button>
          <span class="time">{fmt(now)} / {fmt(hasAudio ? player.duration : song.duration)}</span>
          {loopId && <span class="tag">ループ中：{song.sections.find((s) => s.id === loopId)?.name}<button class="link" onClick={() => { setLoopId(null); player.setLoop(null); }}>解除</button></span>}
          <label class="button file small">
            {hasAudio ? '音源を変更' : '音源を選ぶ'}
            <input type="file" accept=".mp3,.wav,.m4a,.mp4,.aac,audio/*" onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              const f = input.files?.[0];
              input.value = '';
              if (f) void loadAudio(f, false);
            }} />
          </label>
          {hasAudio && !progress && <button class="small" onClick={() => void analyzeBuffer(player.buffer!, song.sections.some((s) => s.edited) ? 'propose' : 'replace')}>再解析</button>}
        </div>
        {fileName && <p class="sub">音源：{fileName}（この端末内だけで使います）</p>}
        {!hasAudio && <p class="sub">再生するには、この端末にある音源ファイルを選んでください。音源は保存されないため、開き直したときは選び直します。</p>}
        {audioNote && <p class="warn">{audioNote}</p>}
        {progress && <Progress p={progress} onCancel={job.current ? () => job.current?.cancel() : undefined} />}
        {analysisError && <p class="error">{analysisError}。区間を手動で編集して作成を続けられます。</p>}
        {notice && <p class="ok">{notice}<button class="link" onClick={() => setNotice('')}>閉じる</button></p>}
        {proposal && (
          <div class="proposal">
            <p>再解析の結果：BPM {proposal.bpm ?? '未確定'}・区間 {proposal.segments.length} 個。採用するまで構成表は変わりません。</p>
            <p class="sub">{proposal.segments.map((g) => `${fmt(g.start, 0)} ${g.group}`).join(' / ')}</p>
            <button class="primary" onClick={adopt}>採用する</button>
            <button onClick={() => setProposal(null)}>採用しない</button>
          </div>
        )}
        <Timeline
          song={song}
          now={now}
          showPlayhead={hasAudio}
          selected={selected}
          onSeek={(t) => { if (hasAudio) { player.seek(t); setNow(t); } }}
          onSelect={setSelected}
          onDragStart={() => { history.current = [...history.current.slice(-99), songRef.current!]; coalesce.current = null; }}
          onDrag={(i, t) => edit((s) => M.moveBoundary(s, i, snapT(t)), { history: false })}
        />
      </section>

      <section class="card tempo">
        <h2>テンポ・拍子</h2>
        {song.beatsUncertain && song.bpmManual == null && <p class="warn">拍・小節を確定できませんでした（未確定）。時刻で構成表を作れます。BPMを入力すると小節数を計算します。</p>}
        <div class="tempo-row">
          <label>BPM
            <input type="number" inputMode="decimal" min={20} max={400} step="0.1" value={song.bpmManual ?? ''}
              placeholder={song.bpmEst ? `${song.bpmEst}（推定）` : '未確定'}
              onInput={(e) => {
                const v = Number((e.currentTarget as HTMLInputElement).value);
                edit((s) => M.setTempo(s, { bpmManual: v >= 20 && v <= 400 ? v : null }), { coalesce: 'bpm' });
              }} />
          </label>
          <label>拍子
            <select value={song.beatsPerBar} onChange={(e) => edit((s) => M.setTempo(s, { beatsPerBar: Number((e.currentTarget as HTMLSelectElement).value) }))}>
              {[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}拍子</option>)}
            </select>
          </label>
          <label>最初の小節頭
            <TimeInput value={song.firstDownbeat} onChange={(t) => edit((s) => M.setTempo(s, { firstDownbeat: t }))} />
          </label>
          {hasAudio && <button class="small" onClick={() => edit((s) => M.setTempo(s, { firstDownbeat: now }))}>再生位置に合わせる</button>}
          <label class="check"><input type="checkbox" checked={snap} onChange={(e) => setSnap((e.currentTarget as HTMLInputElement).checked)} />境界を拍に合わせる</label>
        </div>
        <p class="sub">{bar ? `1小節 ${bar.toFixed(2)}秒・合計 ${totalBars}小節` : '小節数は未確定です'}</p>
        <BpmLookup title={song.title} artist={song.artist} bpmEst={song.bpmEst} bpm={M.bpmOf(song)}
          onApply={(v) => edit((s) => M.setTempo(s, { bpmManual: v }))} />
      </section>

      <section class="card sections">
        <div class="sections-head">
          <h2>構成</h2>
          {hasAudio && <button class="small" disabled={!song.sections.some((s) => now > s.start + M.MIN_SECTION && now < s.end - M.MIN_SECTION)} onClick={() => edit((s) => M.splitAt(s, snapT(now)))}>再生位置で分割</button>}
          {!hasAudio && <button class="small" onClick={() => edit((s) => M.appendSection(s))}>末尾に区間を追加</button>}
        </div>
        {!song.sections.length && <p class="sub">区間がありません。「末尾に区間を追加」から作るか、音源を選んでください。</p>}
        <ol class="section-list">
          {song.sections.map((s, i) => (
            <li key={s.id} class={`section tone-${groupTone(s.group)}${current === s.id && hasAudio ? ' now' : ''}${selected === s.id ? ' sel' : ''}`} onClick={() => setSelected(s.id)}>
              <div class="sec-main">
                <span class="chip" aria-hidden="true" />
                <input class="name" value={s.name} maxLength={200} aria-label="セクション名"
                  onInput={(e) => edit((x) => M.patchSection(x, s.id, { name: (e.currentTarget as HTMLInputElement).value }), { coalesce: `name-${s.id}` })} />
                <select aria-label="反復グループ" value={s.group ?? ''} onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  edit((x) => M.setGroup(x, s.id, v === '' ? null : v));
                }}>
                  {groups.map((g) => <option key={g} value={g}>グループ{g}</option>)}
                  <option value="new">新しいグループ</option>
                  <option value="">グループなし</option>
                </select>
                <span class={`origin ${s.edited ? 'manual' : ''}`}>{s.edited ? '手動修正' : '自動'}</span>
              </div>
              <div class="sec-time">
                {i === 0 ? <span class="t">{fmt(s.start)}</span> : (
                  <span class="t-edit">
                    <button class="tiny" aria-label="開始を早める" onClick={() => edit((x) => M.moveBoundary(x, i, s.start - step))}>−</button>
                    <TimeInput value={s.start} onChange={(t) => t != null && edit((x) => M.moveBoundary(x, i, snapT(t)))} />
                    <button class="tiny" aria-label="開始を遅らせる" onClick={() => edit((x) => M.moveBoundary(x, i, s.start + step))}>＋</button>
                    {hasAudio && <button class="tiny" title="開始位置を再生位置に合わせる" onClick={() => edit((x) => M.moveBoundary(x, i, snapT(now)))}>⇤</button>}
                  </span>
                )}
                <span class="t">〜 {fmt(s.end)}</span>
                <label class="bars">
                  <input type="number" inputMode="numeric" min={0} max={999} value={s.barsManual ?? ''} placeholder={s.barsEst != null ? String(s.barsEst) : '未確定'}
                    aria-label="小節数"
                    onInput={(e) => {
                      const raw = (e.currentTarget as HTMLInputElement).value;
                      edit((x) => M.patchSection(x, s.id, { barsManual: raw === '' ? null : Math.max(0, Math.round(Number(raw))) }), { coalesce: `bars-${s.id}` });
                    }} />小節
                  <span class="sub">{s.barsManual != null ? '手動' : s.barsEst != null ? '推定' : ''}</span>
                  {s.barsNeedsCheck && <span class="tag warn">要確認</span>}
                </label>
              </div>
              <input class="memo" value={s.memo} maxLength={2000} placeholder="メモ（入り・キメ・終わり方など）" aria-label="メモ"
                onInput={(e) => edit((x) => M.patchSection(x, s.id, { memo: (e.currentTarget as HTMLInputElement).value }), { coalesce: `memo-${s.id}` })} />
              <div class="sec-actions">
                {hasAudio && <button class="small" onClick={() => playSection(s)}>ここから再生</button>}
                {hasAudio && <button class={`small${loopId === s.id ? ' on' : ''}`} onClick={() => toggleLoop(s)}>{loopId === s.id ? 'ループ解除' : 'ループ'}</button>}
                <button class="small" onClick={() => {
                  const inside = hasAudio && now > s.start + M.MIN_SECTION && now < s.end - M.MIN_SECTION;
                  edit((x) => M.splitAt(x, inside ? snapT(now) : snapT((s.start + s.end) / 2)));
                }}>分割</button>
                {i < song.sections.length - 1 && <button class="small" onClick={() => edit((x) => M.mergeWithNext(x, s.id))}>次と結合</button>}
                {song.sections.length > 1 && <button class="small danger" onClick={() => edit((x) => M.deleteSection(x, s.id))}>削除</button>}
              </div>
            </li>
          ))}
        </ol>
        <p class="sub">削除した区間は直前の区間（先頭の場合は直後）に結合されます。音源は変更されません。</p>
      </section>

      <section class="card">
        <h2>全体メモ</h2>
        <textarea rows={3} maxLength={2000} value={song.memo} placeholder="曲全体についてのメモ（キー、カウントの出し方など）"
          onInput={(e) => edit((s) => ({ ...s, memo: (e.currentTarget as HTMLTextAreaElement).value }), { coalesce: 'memo' })} />
      </section>

      {id && meta && session && (
        <Manage id={id} meta={meta} session={session}
          onMeta={setMeta}
          onSession={(s) => { L.setSession(id, s, !!localStorage.getItem(`ks-session-${id}`)); setSessionState(s); }}
          onDeleted={async () => { await L.removeDraft(draftKey); L.forgetMine(id); go('#/', true); }} />
      )}

      {needKey && song && <KeyForm inline onSubmit={submitKey} />}

      <footer class="savebar">
        {id && (
          <div class="save-opts">
            <input value={note} maxLength={500} placeholder="変更メモ（任意・閲覧ページに表示）" onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
            <label class="check"><input type="checkbox" checked={!notify} onChange={(e) => setNotify(!(e.currentTarget as HTMLInputElement).checked)} />変更として知らせない</label>
          </div>
        )}
        <div class="save-row">
          <span class={`save-state ${saveState}`}>
            {saveState === 'saving' ? '保存中…' : saveState === 'saved' ? '保存済み' : saveState === 'error' ? '保存できませんでした' : dirty ? (id ? '未保存の変更があります（この端末に退避済み）' : '未保存（この端末に下書きとして退避済み）') : '変更なし'}
          </span>
          <button class="primary" disabled={saveState === 'saving' || (!!id && !dirty) || needKey} onClick={() => void save()}>
            {id ? '保存' : '保存して共有URLを発行'}
          </button>
        </div>
        {saveError && <p class="error">{saveError}</p>}
        {conflict && (
          <div class="conflict">
            <button onClick={() => void reloadLatest()}>最新の版を読み込む（この変更は破棄）</button>
            <button class="danger" onClick={() => void save(true)}>この内容で上書き保存</button>
          </div>
        )}
      </footer>
    </main>
  );
}

function Progress({ p, onCancel }: { p: { ratio: number; stage: string }; onCancel?: () => void }) {
  return (
    <div class="progress" role="status">
      <div class="meter"><div style={{ width: `${Math.round(p.ratio * 100)}%` }} /></div>
      <span>{p.stage}（{Math.round(p.ratio * 100)}%）この端末の中で解析しています。ページを閉じると中断されます。</span>
      {onCancel && <button class="small" onClick={onCancel}>中止</button>}
    </div>
  );
}

function TimeInput({ value, onChange }: { value: number | null; onChange: (t: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : fmt(value, 2));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(value == null ? '' : fmt(value, 2)); }, [value, focus]);
  const commit = () => {
    setFocus(false);
    if (text.trim() === '') { onChange(null); return; }
    const t = parseTime(text);
    if (t == null) setText(value == null ? '' : fmt(value, 2));
    else onChange(t);
  };
  return (
    <input class="time-input" value={text} placeholder="未設定" inputMode="decimal" aria-label="時刻（分:秒）"
      onFocus={() => setFocus(true)}
      onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
  );
}

function KeyForm({ onSubmit, inline }: { onSubmit: (key: string, remember: boolean) => Promise<string | undefined>; inline?: boolean }) {
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const body = (
    <section class="card">
      <h2>秘密キーを入力</h2>
      <p>この曲メモを編集するには、作成時に表示された秘密キーが必要です。</p>
      <form onSubmit={async (e) => { e.preventDefault(); setError((await onSubmit(key, remember)) ?? ''); }}>
        <input value={key} autoComplete="off" spellcheck={false} placeholder="48桁の英数字" onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
        <label class="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember((e.currentTarget as HTMLInputElement).checked)} />このブラウザに編集権限を記憶する（共用端末では外してください）</label>
        <button class="primary" type="submit">編集を始める</button>
      </form>
      {error && <p class="error">{error}</p>}
    </section>
  );
  return inline ? body : <main class="page narrow">{body}<a href="#/">トップへ</a></main>;
}

function CreatedDialog({ info, onRemember, onClose }: { info: { viewId: string; key: string }; onRemember: (r: boolean) => void; onClose: () => void }) {
  const [copied, setCopied] = useState('');
  const url = viewUrl(info.viewId);
  return (
    <div class="dialog-back">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="created-title">
        <h2 id="created-title">保存しました</h2>
        <p>この閲覧URLをメンバーに共有してください（LINE などに貼り付け）。URLを知っている人は構成表を見られます。</p>
        <div class="copy-row"><code>{url}</code><button onClick={async () => setCopied((await copy(url)) ? 'url' : '')}>{copied === 'url' ? 'コピー済み' : 'コピー'}</button></div>
        <h3>秘密キー（編集用）</h3>
        <p class="warn">編集・削除に必要です。アカウントがないため、<strong>なくすと復旧できません</strong>。メンバーには共有せず、安全な場所に控えてください。</p>
        <div class="copy-row"><code>{info.key}</code><button onClick={async () => setCopied((await copy(info.key)) ? 'key' : '')}>{copied === 'key' ? 'コピー済み' : 'コピー'}</button></div>
        <label class="check"><input type="checkbox" defaultChecked onChange={(e) => onRemember((e.currentTarget as HTMLInputElement).checked)} />このブラウザに編集権限を記憶する</label>
        <button class="primary" onClick={onClose}>控えました</button>
      </div>
    </div>
  );
}
