import { useEffect, useRef, useState } from 'preact/hooks';
import * as M from '../../../shared/song';
import type { AnalysisResult, Section, Song } from '../../../shared/song';
import { checkFile, MAX_SECONDS, Player } from '../audio/player';
import { Metronome } from '../audio/metronome';
import { YouTubePlayer, type Playback } from '../audio/youtube';
import { runAnalysis, toAnalysisSamples, type AnalysisJob } from '../analysis/run';
import { api, ApiError, randomHex, track, type MemoInfo, type Role } from '../api';
import * as L from '../storage/local';
import { BpmLookup } from './BpmLookup';
import { CreatedDialog } from './CreatedDialog';
import { ExportText } from './ExportText';
import { ImportText } from './ImportText';
import { KeyForm } from './KeyForm';
import { Progress } from './Progress';
import { SeekBar } from './SeekBar';
import { SongLookup } from './SongLookup';
import { Manage } from './Manage';
import { ShareButtons } from './ShareButtons';
import { TimeInput } from './TimeInput';
import { Timeline } from './Timeline';
import { useSongHistory, type EditOptions } from './useSongHistory';
import { YouTubeAlign } from './YouTubeAlign';
import { errorText, fmt, go, groupTone, handoff, shareMessage, TIME_SIGNATURES, timeSignature, viewUrl } from './util';

type Mode = { kind: 'draft'; manual: boolean; importText?: boolean } | { kind: 'saved'; id: string };

// 再生は画面をまたいで1つだけ。初回保存で編集画面に切り替わっても、選んだ音源を使い続ける
const player = new Player();
let playerFile = '';
let yt: YouTubePlayer | null = null;
// 再生に使うもの。音源ファイルを選んでいればそれを、なければ YouTube の動画を使う
const media = (): Playback => (player.buffer || !yt ? player : yt);
const canPlay = () => !!player.buffer || !!yt;
const metronome = new Metronome();
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function Editor({ mode }: { mode: Mode }) {
  const id = mode.kind === 'saved' ? mode.id : null;
  const draftKey = id ? `pending:${id}` : 'draft';

  // 構成データと「元に戻す」「やり直す」の履歴
  const h = useSongHistory();
  const { song, ref: songRef, dirty, setDirty, undo, redo } = h;

  // 保存済みメモの情報と権限
  const [meta, setMeta] = useState<MemoInfo | null>(null);
  const base = useRef<number | null>(null); // 編集の元になった版番号
  const createInfo = useRef<{ requestId: string; key: string; editKey?: string } | null>(null);
  const [role, setRole] = useState<Role | null>(null); // admin：管理キー、edit：編集キー
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
  // YouTube の動画（song.youtube）。音源ファイルがないときの再生に使う
  const ytHost = useRef<HTMLDivElement>(null);
  const [ytReady, setYtReady] = useState(false);
  const [ytError, setYtError] = useState('');
  const [ytInput, setYtInput] = useState('');
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopId, setLoopId] = useState<string | null>(null);
  const loopIdRef = useRef<string | null>(null);
  loopIdRef.current = loopId;
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState<'bar' | 'beat' | 'off'>('bar'); // 境界を合わせる先
  const [splitForm, setSplitForm] = useState<{ id: string; bars: string; error: string } | null>(null);
  const [follow, setFollow] = useState(true); // 再生中の区間に自動でスクロールする
  const rows = useRef(new Map<string, HTMLLIElement>());

  // 解析
  const [progress, setProgress] = useState<{ ratio: number; stage: string } | null>(null);
  const job = useRef<AnalysisJob | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [proposal, setProposal] = useState<AnalysisResult | null>(null);
  const [notice, setNotice] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [importing, setImporting] = useState(mode.kind === 'draft' && !!mode.importText);
  // BPM を指定してやり直したとき、音から測ったテンポが指定と違った場合の記録
  const [bpmCheck, setBpmCheck] = useState<{ hint: number; measured: number } | null>(null);
  const [slowDismissed, setSlowDismissed] = useState(false);
  const [netBpm, setNetBpm] = useState<number | null>(null); // ネット上の BPM（いちばん上の候補）
  const autoFixed = useRef(''); // ネットの BPM を参考に自動で作り直した組み合わせ（繰り返さないため）
  const [ticking, setTicking] = useState(false); // メトロノームを鳴らしているか

  // 保存
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState<{ version: number } | null>(null);
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);

  // 以前の形式（無音の区間）は、曲の頭を 0:00 にした形に直して開く。保存すると直した形で残る
  const init = (loaded: Song) => h.init(M.trimSilence(loaded));

  function edit(fn: (s: Song) => Song, opts?: EditOptions) {
    if (h.edit(fn, opts) && saveState === 'saved') setSaveState('idle');
  }

  // 自動生成をやり直すとき、手で直した区間があれば結果を見て選んでもらい、なければそのまま置き換える
  const redoHow = (s: Song) => (s.sections.some((x) => x.edited) ? 'propose' : 'replace');

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
    return () => { job.current?.cancel(); player.pause(); player.loop = null; yt?.destroy(); yt = null; metronome.stop(); };
  }, []);

  async function loadSaved(token: string | null) {
    if (!id) return;
    if (!token) { setNeedKey(true); return; }
    try {
      const d = await api.get(id, token);
      setMeta(d);
      setRole(d.role);
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
      } else setLoadError(errorText(e, '読み込めませんでした'));
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

  // YouTube の動画を表示する。動画が変わったら作り直し、外したら破棄する
  const videoId = song?.youtube ?? null;
  useEffect(() => {
    if (!videoId || !ytHost.current) return;
    let alive = true;
    let made: YouTubePlayer | null = null;
    setYtError('');
    YouTubePlayer.create(ytHost.current, videoId).then((p) => {
      if (!alive) { p.destroy(); return; }
      made = p;
      yt = p;
      p.offset = songRef.current?.youtubeOffset ?? 0;
      p.onError = setYtError;
      setYtReady(true);
      // 手動で作り始めたばかりなら動画の長さで区間を作る（長さの違いは「音源とのずれを合わせる」で示す）
      const d = p.duration;
      if (d > 0 && !songRef.current!.sections.length) edit((s) => M.wholeSong(s, d), { history: false });
    }).catch((e) => { if (alive) setYtError(errorText(e, '動画を読み込めませんでした')); });
    return () => {
      alive = false;
      setYtReady(false);
      if (made) { made.destroy(); if (yt === made) yt = null; }
      if (loopIdRef.current) setLoopId(null);
    };
  }, [videoId]);

  function setVideo(e: Event) {
    e.preventDefault();
    const v = M.youtubeId(ytInput);
    if (!v) { setYtError('YouTube の動画の URL を読み取れませんでした'); return; }
    setYtInput('');
    setAudioNote('');
    edit((s) => ({ ...s, youtube: v, youtubeOffset: undefined }));
    track('youtube_set');
  }

  // 再生位置の表示
  useEffect(() => {
    const t = setInterval(() => { setNow(media().currentTime); setPlaying(media().playing); }, 100);
    return () => clearInterval(t);
  }, []);

  // 区間の境界が変わったらループ範囲も合わせる
  useEffect(() => {
    if (!loopId || !song) return;
    const s = song.sections.find((x) => x.id === loopId);
    if (!s) { setLoopId(null); media().setLoop(null); return; }
    if (media().loop?.start !== s.start || media().loop?.end !== s.end) media().setLoop({ start: s.start, end: s.end });
  }, [song, loopId]);

  // 再生中は、鳴っている区間を画面内に表示する（入力中は動かさない）
  // 表示用の now は 0.1 秒ごとの更新なので、再生を始めた直後は古い位置のことがある。実際の再生位置で判断する
  const playPos = media().currentTime;
  const playingId = media().playing && songRef.current ? M.sectionAt(songRef.current, playPos)?.id : undefined;
  useEffect(() => {
    if (!follow || !playingId) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    rows.current.get(playingId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playingId, follow]);

  // ネット上の BPM から推定が倍・半分を取り違えていると分かったら、手で直した区間がなければ自動で作り直す
  useEffect(() => {
    const s = songRef.current;
    if (!s?.analysis || s.bpmManual != null || s.bpmEst == null || netBpm == null || !player.buffer || progress) return;
    if (s.sections.some((x) => x.edited)) return;
    const f = M.octaveByReference(s.bpmEst, netBpm);
    if (f !== 2 && f !== 0.5) return;
    const key = `${netBpm}:${s.bpmEst}`;
    if (autoFixed.current === key) return;
    autoFixed.current = key;
    const from = s.bpmEst, to = Math.round(from * f * 10) / 10;
    void analyzeBuffer(player.buffer, 'replace', to).then(() =>
      setNotice(`ネット上の BPM（${netBpm}）を参考に、テンポを ${to} に直して作り直しました（推定 ${from} は${f === 2 ? '半分' : '2倍'}のテンポでした）。`));
  }, [netBpm, song?.bpmEst, progress]);

  // メトロノームは今の BPM・拍子で鳴らす。BPM が空になったら止め、入れ直したら続きを鳴らす
  const tempoBpm = song ? M.bpmOf(song) : null;
  metronome.bpm = tempoBpm ?? 0;
  metronome.beatsPerBar = song?.beatsPerBar ?? 4;
  useEffect(() => {
    if (ticking && tempoBpm) metronome.start(); else metronome.stop();
  }, [ticking, !!tempoBpm]);

  // キーボード：スペースで再生・停止、Ctrl/⌘+Z で元に戻す、Ctrl/⌘+Shift+Z・Ctrl+Y でやり直す（入力欄の中では使わない）
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (e.key === ' ' && canPlay()) { e.preventDefault(); togglePlay(); }
      const key = e.key.toLowerCase();
      if (key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) || (key === 'y' && e.ctrlKey)) { e.preventDefault(); redo(); }
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
      yt?.pause();
      const cur = songRef.current!;
      if (!cur.sections.length && !analyzeNow) {
        edit((s) => M.wholeSong(s, buf.duration, true));
      } else if (cur.sections.length && Math.abs((cur.audio?.duration ?? cur.duration) - buf.duration) > 1) {
        // 構成を作った音源ファイルの長さと比べる（構成表の長さは曲頭・曲末の無音を含まないため）
        setAudioNote(`構成表を作った音源の長さ（${fmt(cur.audio?.duration ?? cur.duration)}）と、選んだ音源の長さ（${fmt(buf.duration)}）が違います。別バージョンの音源かもしれません。`);
      }
      if (analyzeNow) await analyzeBuffer(buf, cur.sections.length ? 'propose' : 'replace');
      else setProgress(null);
    } catch (e) {
      setProgress(null);
      setAudioNote(errorText(e, '音源を読み込めませんでした'));
    }
  }

  async function analyzeBuffer(buf: AudioBuffer, how: 'replace' | 'propose', bpm?: number) {
    setAnalysisError('');
    setProposal(null);
    setProgress({ ratio: 0, stage: '解析の準備をしています' });
    try {
      const samples = await toAnalysisSamples(buf);
      const j = runAnalysis(samples, (ratio, stage) => setProgress({ ratio, stage }), bpm);
      job.current = j;
      const { result, ms } = await j.promise;
      setBpmCheck(bpm && result.bpm ? { hint: bpm, measured: result.bpm } : null);
      track('analysis_ok', { durationMs: Math.round(ms), audioSec: buf.duration });
      if (how === 'replace') {
        edit((s) => M.songFromAnalysis(result, s));
        setSelected(null);
      } else setProposal(result);
    } catch (e) {
      const msg = errorText(e, '解析に失敗しました');
      setAnalysisError(msg);
      if (msg !== '解析を中止しました') track('analysis_fail', { error: msg.slice(0, 60), audioSec: buf.duration });
      if (!songRef.current?.sections.length) edit((s) => M.wholeSong(s, buf.duration, true));
    } finally {
      job.current = null;
      setProgress(null);
    }
  }

  // 自動生成のやり直し結果を反映する。rebuild は手動修正を捨てて構成を作り直す
  function adopt(rebuild: boolean) {
    if (!proposal) return;
    if (rebuild) {
      edit((s) => M.regenerateFromAnalysis(s, proposal));
      setSelected(null);
      setNotice('自動生成の結果で構成を作り直しました。「元に戻す」で取り消せます。');
    } else {
      edit((s) => M.adoptAnalysis(s, proposal).song);
      setNotice('区間はそのままにして、テンポの推定値だけを更新しました。');
    }
    setProposal(null);
  }

  // 再生操作（iPhone ではタップを起点にしないと音が出ない）
  // 再生・移動の操作をしたら、表示上の再生位置もすぐに合わせる
  function syncNow() {
    setNow(media().currentTime);
    setPlaying(media().playing);
  }

  function togglePlay() {
    if (media().playing) media().pause();
    else media().play();
    syncNow();
  }
  // シークバー・タイムラインから再生位置を動かす。ループ中に範囲の外へ動かしたらループを解除する
  function seekTo(t: number) {
    const l = media().loop;
    if (l && (t < l.start || t >= l.end)) { setLoopId(null); media().setLoop(null); }
    media().seek(t);
    setNow(t);
  }

  // 止めている再生位置（シークバーで動かした位置など）がこの区間の中なら、そこから再生する
  const resumeAt = (s: Section) => {
    const t = media().currentTime;
    return !media().playing && t > s.start + 0.05 && t < s.end - 0.05 ? t : null;
  };

  function playSection(s: Section) {
    if (loopId) { setLoopId(s.id); media().loop = { start: s.start, end: s.end }; }
    media().play(resumeAt(s) ?? s.start);
    setSelected(s.id);
    syncNow();
  }
  function toggleLoop(s: Section) {
    if (loopId === s.id) { setLoopId(null); media().setLoop(null); return; }
    setLoopId(s.id);
    const from = resumeAt(s);
    media().setLoop({ start: s.start, end: s.end });
    if (!media().playing) media().play(from ?? s.start);
    syncNow();
    track('loop_play');
  }

  // 境界の吸着。小節の頭に合わせるときは、その境界の手前の区間の始まり（anchor）から小節を数える
  const snapT = (t: number, anchor?: number) => {
    const s = songRef.current;
    if (!s || snap === 'off') return t;
    return snap === 'bar' ? M.snapToBar(s, t, anchor) : M.snapToBeat(s, t);
  };
  const prevStart = (s: Song, i: number) => s.sections[i - 1]?.start;
  const containingStart = (s: Song, t: number) => M.sectionAt(s, t)?.start;

  // 「分割」：小節が分かれば「先頭から何小節で分けるか」を入力してもらう。分からなければ再生位置か真ん中で分ける
  function openSplit(s: Section) {
    const cur = songRef.current!;
    const barLen = M.barSeconds(cur);
    const inside = canPlay() && now > s.start + M.MIN_SECTION && now < s.end - M.MIN_SECTION;
    if (!barLen) {
      edit((x) => M.splitAt(x, inside ? snapT(now, s.start) : snapT((s.start + s.end) / 2, s.start)));
      return;
    }
    const total = s.barsManual ?? s.barsEst ?? 0;
    const n = inside ? Math.round((now - s.start) / barLen) : Math.floor(total / 2);
    setSplitForm({ id: s.id, bars: String(Math.max(1, n)), error: '' });
  }

  function submitSplit(s: Section) {
    if (!splitForm) return;
    const n = Number(splitForm.bars);
    const t = Number.isInteger(n) && n > 0 ? M.barPositionIn(songRef.current!, s, n) : null;
    if (t == null || t <= s.start + M.MIN_SECTION || t >= s.end - M.MIN_SECTION) {
      setSplitForm({ ...splitForm, error: `1〜${Math.max(1, (s.barsManual ?? s.barsEst ?? 2) - 1)} の小節数を入力してください` });
      return;
    }
    edit((x) => M.splitAt(x, t));
    setSplitForm(null);
  }

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
        createInfo.current.editKey ??= randomHex(24);
        await L.saveDraft('draft', { song: s, updatedAt: Date.now(), create: createInfo.current });
        const c = await api.create(createInfo.current.requestId, createInfo.current.key, createInfo.current.editKey, s);
        L.setSession(c.id, c.session, true);
        L.setKeys(c.id, { admin: createInfo.current.key, edit: createInfo.current.editKey });
        L.rememberMine({ id: c.id, title: s.title, updatedAt: c.updatedAt });
        await L.removeDraft('draft');
        handoff.created = { id: c.id, viewId: c.viewId!, key: createInfo.current.key, editKey: createInfo.current.editKey, title: s.title, artist: s.artist };
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
        setSaveError('他の端末で更新されています。最新の内容を読み込むか、この内容で上書きするかを選んでください。');
      } else if (e instanceof ApiError && e.status === 401) {
        setSaveError('編集の有効期限が切れたか、キーが再発行されました。キーを入力すると、変更を保持したまま保存できます。');
        setSessionState(null);
        setNeedKey(true);
      } else setSaveError(`${errorText(e, '保存できませんでした')}。変更はこの端末に残っています。`);
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
      const k = key.trim().toLowerCase();
      const { session: s, role: r } = await api.session(id, k);
      L.setSession(id, s, remember);
      if (remember) L.setKeys(id, r === 'admin' ? { admin: k } : { edit: k });
      setSessionState(s);
      setRole(r);
      if (songRef.current && dirty) { setNeedKey(false); setSaveState('idle'); setSaveError(''); return; }
      await loadSaved(s);
    } catch (e) {
      return errorText(e, '確認できませんでした');
    }
  }

  // ---- 表示 ----
  if (loadError) return <main class="page narrow"><p class="error">{loadError}</p><a href="#/">トップへ</a></main>;
  if (needKey && !song) return <KeyForm onSubmit={submitKey} />;
  if (!song) return <main class="page narrow"><p>読み込んでいます…</p>{progress && <Progress p={progress} />}</main>;

  const groups = M.groupsOf(song);
  const bar = M.barSeconds(song);
  const beat = M.bpmOf(song) ? 60 / M.bpmOf(song)! : null;
  const step = snap === 'bar' && bar ? bar : snap !== 'off' && beat && M.hasGrid(song) ? beat : 0.1;
  const currentSection = canPlay() ? M.sectionAt(song, now) ?? null : null;
  const current = currentSection?.id;
  // 曲の頭が音源ファイル・動画の何秒目か（ずれ）を、再生に反映する。再生の時刻や長さを表示する前に合わせる
  // （止まっているときは再描画が起きないため、描画のあとで合わせると古い長さが表示されたままになる）
  player.offset = song.audio?.offset ?? 0;
  if (yt) yt.offset = song.youtubeOffset ?? 0;
  const hasAudio = canPlay(); // 再生できる（音源ファイルか YouTube の動画）
  const canAnalyze = !!player.buffer; // 自動生成に使える（音源ファイルのみ）
  // 区間名の候補（自動推定）。名前を付けていない区間にだけ示す
  const suggested = M.suggestNames(song);
  // 繰り返しにすでに同じ名前が付いている区間（「Aメロ（2回目）」など）には出さない
  const hintFor = (s: Section) => (s.nameAuto && suggested[s.id] && !(s.group && song.groupNames?.[s.group] === suggested[s.id]) ? suggested[s.id] : null);
  const hintCount = song.sections.filter((s) => hintFor(s)).length;
  const totalBars = song.sections.reduce((p, s) => p + (s.barsManual ?? s.barsEst ?? 0), 0);
  // 手入力・ネット上の BPM が自動生成時の推定と違うとき（倍・半分の誤認など）は、そのBPMでやり直せるようにする
  // 推定が遅め（90未満）なら、2倍のテンポかもしれないと知らせる（半分のテンポへの誤認がよくあるため）
  // ネット上の BPM を参考に、推定の倍・半分の取り違えを判定する
  const netFactor = song.analysis && song.bpmManual == null && song.bpmEst != null && netBpm != null ? M.octaveByReference(song.bpmEst, netBpm) : null;
  const octaveFix = netFactor === 2 || netFactor === 0.5 ? Math.round(song.bpmEst! * netFactor * 10) / 10 : null;
  const slowBpm = song.analysis && song.bpmManual == null && song.bpmEst != null && song.bpmEst < 90 && !song.beatsUncertain && netFactor !== 1 && !octaveFix
    ? Math.round(song.bpmEst * 20) / 10 : null;
  const redoBpm = song.analysis && song.bpmManual != null && (song.bpmEst == null || Math.abs(song.bpmManual / song.bpmEst - 1) > 0.03) ? song.bpmManual : null;

  return (
    <main class="page editor">
      <header class="bar">
        <a href="#/" class="home"><img src="./favicon.svg" alt="" />曲のしおり</a>
        <span class="state">{id ? (meta ? `最終保存 ${new Date(meta.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '') : '下書き（この端末にだけ保存）'}</span>
        <button class="small" onClick={undo} disabled={!h.canUndo} title="元に戻す（Ctrl/⌘+Z）">元に戻す</button>
        <button class="small" onClick={redo} disabled={!h.canRedo} title="やり直す（Ctrl/⌘+Shift+Z）">やり直す</button>
        <a class="button small new-link" href="#/" target="_blank" rel="noopener" title="新しいタブで開きます（音源から作る・手動で作る・テキストから作る）">＋ 新しく作る</a>
      </header>

      {created && (
        <CreatedDialog
          info={created}
          onRemember={(r) => {
            if (!session || !id) return;
            L.setSession(id, session, r);
            // 記憶しない場合は、発行したキーもこのブラウザに残さない
            if (r) L.setKeys(id, { admin: created.key, edit: created.editKey }); else L.forgetKeys(id);
          }}
          onClose={() => { handoff.created = null; setCreated(null); }}
        />
      )}

      {restore && (
        <section class="card notice">
          <p>この曲メモには、保存されていない変更がこの端末に残っています。{restore.baseVersion !== meta?.version && '（そのあとに別の端末で更新されています。保存するときに、どちらを残すか確認します）'}</p>
          <div class="actions">
            <button class="primary" onClick={() => { base.current = restore.baseVersion ?? base.current; edit(() => M.trimSilence(restore.song)); setRestore(null); }}>変更を復元する</button>
            <button onClick={() => { void L.removeDraft(draftKey); setRestore(null); }}>破棄する</button>
          </div>
        </section>
      )}

      <section class="card song-info">
        <div class="row2">
          <label>曲名<input value={song.title} maxLength={200} onInput={(e) => edit((s) => ({ ...s, title: (e.currentTarget as HTMLInputElement).value }), { coalesce: 'title' })} /></label>
          <label>アーティスト<input value={song.artist} maxLength={200} onInput={(e) => edit((s) => ({ ...s, artist: (e.currentTarget as HTMLInputElement).value }), { coalesce: 'artist' })} /></label>
        </div>
        <SongLookup title={song.title} artist={song.artist} duration={hasAudio ? media().duration : null}
          onPick={(t) => edit((s) => ({ ...s, title: t.title, artist: t.artist }))} />
      </section>

      <section class="card player">
        <div class="player-row">
          <button class="primary play" onClick={togglePlay} disabled={!hasAudio}>{playing ? '一時停止' : '再生'}</button>
          <span class="time">{fmt(now)} / {fmt(hasAudio ? media().duration : song.duration)}</span>
          {currentSection && <span class={`now-tag tone-${groupTone(currentSection.group)}`}><span class="chip" aria-hidden="true" />{playing ? '再生中' : '再生位置'}：{currentSection.name}</span>}
          {loopId && <span class="tag">ループ中：{song.sections.find((s) => s.id === loopId)?.name}<button class="link" onClick={() => { setLoopId(null); media().setLoop(null); }}>解除</button></span>}
          <span class="spacer" />
          <label class={`button file small${hasAudio ? '' : ' primary'}`}>
            {player.buffer ? '音源を変更' : '音源ファイルを選ぶ'}
            <input type="file" accept=".mp3,.wav,.m4a,.mp4,.aac,audio/*" onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              const f = input.files?.[0];
              input.value = '';
              if (f) void loadAudio(f, false);
            }} />
          </label>
          {canAnalyze && !progress && (
            // 今の BPM（推定・手入力）を前提にやり直す。前提なしで推定し直すと、半分のテンポへの誤認などに戻ってしまうため
            <button class="small" title={M.bpmOf(song) ? `BPM ${M.bpmOf(song)} を前提に作り直します` : undefined}
              onClick={() => void analyzeBuffer(player.buffer!, redoHow(song), M.bpmOf(song) ?? undefined)}>自動生成をやり直す</button>
          )}
        </div>
        {fileName && <p class="sub">音源：{fileName}（この端末内だけで使います）{videoId && '。YouTube の動画より音源ファイルを優先して再生します'}</p>}
        {!hasAudio && !videoId && <p class="sub">再生や自動生成のやり直しには、この端末にある音源ファイルを選んでください。音源は保存されないため、開き直したときは選び直します。</p>}
        {videoId ? (
          <div class={`yt${player.buffer ? ' muted' : ''}`}>
            <div class="yt-frame"><div ref={ytHost} /></div>
            <p class="sub">
              YouTube の動画で再生します（自動生成には使えません）。動画は構成表と一緒に保存され、閲覧ページでも聴けます。
              <a href={M.youtubeUrl(videoId)} target="_blank" rel="noopener">YouTube で開く</a>
              <button class="link" onClick={() => { setYtError(''); edit((s) => ({ ...s, youtube: null, youtubeOffset: undefined })); }}>動画を外す</button>
            </p>
            {!ytReady && !ytError && <p class="sub">動画を読み込んでいます…</p>}
            {ytReady && yt && !player.buffer && (
              <YouTubeAlign song={song} videoDuration={yt.duration + yt.offset} videoTime={() => yt?.videoTime ?? 0}
                onChange={(x) => edit((s) => ({ ...s, youtubeOffset: x || undefined }), { coalesce: 'youtube-offset' })} />
            )}
          </div>
        ) : (
          <form class="yt-form" onSubmit={setVideo}>
            <input value={ytInput} placeholder="YouTube の動画の URL を貼り付け" aria-label="YouTube の動画の URL" inputMode="url"
              onInput={(e) => { setYtInput((e.currentTarget as HTMLInputElement).value); setYtError(''); }} />
            <button class="small" type="submit" disabled={!ytInput.trim()}>YouTube の動画で再生</button>
          </form>
        )}
        {ytError && <p class="error">{ytError}</p>}
        {audioNote && <p class="warn">{audioNote}</p>}
        {progress && <Progress p={progress} onCancel={job.current ? () => job.current?.cancel() : undefined} />}
        {analysisError && <p class="error">{analysisError}。区間を手動で編集して作成を続けられます。</p>}
        {notice && <p class="ok">{notice}<button class="link" onClick={() => setNotice('')}>閉じる</button></p>}
        {proposal && (
          <div class="proposal">
            <p>自動生成の結果：BPM {proposal.bpm ?? '未確定'}・区間 {proposal.segments.length} 個。選ぶまで構成表は変わりません。</p>
            <p class="sub">{proposal.segments.map((g) => `${fmt(Math.max(0, g.start - (proposal.leadingSilence ?? 0)), 0)} ${g.group}`).join(' / ')}</p>
            <p class="warn">手動で直した内容があります。作り直すと、区間の区切り・名前・小節数・メモなどの手動修正は消えます（曲名・アーティスト・全体メモは残ります。「元に戻す」で取り消せます）。</p>
            <button class="primary" onClick={() => adopt(true)}>この結果で作り直す</button>
            <button onClick={() => adopt(false)}>テンポの推定だけ更新（区間はそのまま）</button>
            <button onClick={() => setProposal(null)}>キャンセル</button>
          </div>
        )}
        {hasAudio && <SeekBar now={now} duration={media().duration} onSeek={seekTo} />}
        <Timeline
          song={song}
          now={now}
          showPlayhead={hasAudio}
          selected={selected}
          onSeek={(t) => { if (hasAudio) seekTo(t); }}
          onSelect={setSelected}
          onDragStart={h.checkpoint}
          onDrag={(i, t) => edit((s) => M.moveBoundary(s, i, snapT(t, prevStart(s, i))), { history: false })}
        />
      </section>

      <section class="card tempo">
        <div class="tempo-head">
          <h2>テンポ</h2>
          <span class="sub">{bar ? `合計 ${totalBars}小節` : '小節数は未確定'}</span>
        </div>
        {song.beatsUncertain && song.bpmManual == null && <p class="warn">拍・小節を確定できませんでした。BPMを入力すると小節数を数えます。</p>}
        <div class="tempo-row">
          <label><span>BPM{song.bpmManual != null && <span class="sub">（手入力）</span>}</span>
            <span class="with-button">
              <input type="number" inputMode="decimal" min={20} max={400} step="0.1" value={song.bpmManual ?? ''}
                placeholder={song.bpmEst ? `${song.bpmEst}（推定）` : '未確定'}
                onInput={(e) => {
                  const v = Number((e.currentTarget as HTMLInputElement).value);
                  edit((s) => M.setTempo(s, { bpmManual: v >= 20 && v <= 400 ? v : null }), { coalesce: 'bpm' });
                }} />
              <button class={`small${ticking && tempoBpm ? ' on' : ''}`} disabled={!tempoBpm} title="この BPM でクリック音を鳴らします。曲を再生しながら鳴らすと、テンポが合っているか聴き比べられます"
                onClick={() => {
                  // iPhone ではタップの中で鳴らし始めないと音が出ないため、ここで始める
                  if (ticking) metronome.stop(); else metronome.start();
                  setTicking(!ticking);
                }}>{ticking && tempoBpm ? '■ メトロノーム' : '♪ メトロノーム'}</button>
              {song.bpmManual != null && (
                <button class="small" onClick={() => { edit((s) => M.setTempo(s, { bpmManual: null })); setBpmCheck(null); }}>
                  {song.bpmEst ? `推定（${song.bpmEst}）に戻す` : '手入力をやめる'}
                </button>
              )}
            </span>
          </label>
          <label>最初の小節頭
            <span class="with-button">
              <TimeInput value={song.firstDownbeat} onChange={(t) => edit((s) => M.setTempo(s, { firstDownbeat: t }))} />
              {hasAudio && <button class="small" onClick={() => edit((s) => M.setTempo(s, { firstDownbeat: now }))}>再生位置にする</button>}
            </span>
          </label>
        </div>
        {octaveFix && (song.sections.some((s) => s.edited) || !canAnalyze) && (
          <div class="redo-bpm">
            <p>ネット上の BPM（{netBpm}）から見ると、推定 {song.bpmEst} は{netFactor === 2 ? '半分' : '2倍'}のテンポのようです。</p>
            {canAnalyze
              ? <button class="small primary" disabled={!!progress} onClick={() => void analyzeBuffer(player.buffer!, 'propose', octaveFix)}>{octaveFix} で作り直す</button>
              : <span class="sub">音源ファイルを選ぶと {octaveFix} で作り直せます。</span>}
          </div>
        )}
        {slowBpm && !slowDismissed && (
          <div class="redo-bpm">
            <p>推定テンポは {song.bpmEst} と遅めです。速い曲なら、実際は2倍の <strong>{slowBpm}</strong> かもしれません（テンポを半分に聞き取る誤りはよくあります）。</p>
            {canAnalyze
              ? <button class="small primary" disabled={!!progress} onClick={() => void analyzeBuffer(player.buffer!, redoHow(song), slowBpm)}>{slowBpm} で作り直す</button>
              : <span class="sub">音源ファイルを選ぶと {slowBpm} で作り直せます。</span>}
            <button class="small" onClick={() => setSlowDismissed(true)}>{song.bpmEst} のままでよい</button>
          </div>
        )}
        {redoBpm && bpmCheck?.hint === redoBpm && Math.abs(bpmCheck.measured / redoBpm - 1) > 0.03 ? (
          <div class="redo-bpm warn-box">
            <p>BPM {redoBpm} で解析し直しましたが、音から測ると <strong>{bpmCheck.measured}</strong> でした。{redoBpm} のままだと小節数がずれる可能性があります。</p>
            <button class="small primary" onClick={() => {
              const m = bpmCheck.measured;
              // 推定がすでに測った値と揃っていれば手入力をやめて推定を使い、揃っていなければ測った値を入れる
              edit((s) => M.setTempo(s, { bpmManual: s.bpmEst != null && Math.abs(s.bpmEst / m - 1) <= 0.03 ? null : m }));
              setBpmCheck(null);
            }}>{bpmCheck.measured} を使う</button>
            <button class="small" onClick={() => setBpmCheck({ ...bpmCheck, hint: -1 })}>{redoBpm} のままにする</button>
          </div>
        ) : redoBpm && bpmCheck?.hint !== -1 && (canAnalyze
          ? <div class="redo-bpm">
              <p>区切りは推定テンポ {song.bpmEst ?? '未確定'} で作られています。BPM {redoBpm} で作り直すと、区切りと小節数が正確になります。</p>
              <button class="small" disabled={!!progress} onClick={() => void analyzeBuffer(player.buffer!, redoHow(song), redoBpm)}>BPM {redoBpm} で自動生成をやり直す</button>
            </div>
          : <p class="sub">音源ファイルを選ぶと、BPM {redoBpm} を前提に自動生成をやり直せます。</p>)}
        <BpmLookup title={song.title} artist={song.artist} bpmEst={song.bpmEst} bpm={M.bpmOf(song)}
          onResult={(c) => setNetBpm(c[0]?.bpm ?? null)}
          onApply={(v) => edit((s) => M.setTempo(s, { bpmManual: v }))} />
        <details class="more">
          <summary>詳しい設定（拍子・小節の線）</summary>
          <label>拍子
            <select value={song.beatsPerBar} onChange={(e) => edit((s) => M.setTempo(s, { beatsPerBar: Number((e.currentTarget as HTMLSelectElement).value) }))}>
              {(TIME_SIGNATURES.includes(song.beatsPerBar) ? TIME_SIGNATURES : [...TIME_SIGNATURES, song.beatsPerBar]).map((n) =>
                <option key={n} value={n}>{timeSignature(n)}</option>)}
            </select>
          </label>
          <p class="sub">変えると小節数の数え方が変わります。</p>
          {bar && <p class="sub">1小節 約{bar.toFixed(2)}秒。小節の線は{M.usesDetectedBeats(song) ? '、解析で見つけた拍に沿って引いています（テンポの揺れに追従）。' : '、BPM と最初の小節頭から等間隔に引いています。'}</p>}
        </details>
      </section>

      <section class="card sections">
        <div class="card-head">
          <h2>構成</h2>
          <span class="sub">{song.sections.length}区間{bar ? `・合計 ${totalBars}小節` : ''}</span>
        </div>
        <div class="sections-tools">
          {hasAudio && <button class="small" disabled={!song.sections.some((s) => now > s.start + M.MIN_SECTION && now < s.end - M.MIN_SECTION)} onClick={() => edit((s) => M.splitAt(s, snapT(now, containingStart(s, now))))}>再生位置で分割</button>}
          {!hasAudio && <button class="small" onClick={() => edit((s) => M.appendSection(s))}>末尾に区間を追加</button>}
          {hintCount > 0 && <button class="small" title="繰り返し・並び・音量から推定した候補です。聴いて確かめてください"
            onClick={() => { edit((s) => M.applySuggestedNames(s)); setNotice('名前の候補を付けました。推定なので、聴いて確かめてください（「元に戻す」で取り消せます）。'); }}>名前の候補をまとめて付ける</button>}
          {song.analysis?.segments.length ? <button class="small" onClick={() => setConfirmReset(true)}>自動解析の結果に戻す</button> : null}
          <span class="spacer" />
          <label class="inline snap">境界を合わせる先
            <select value={snap} onChange={(e) => setSnap((e.currentTarget as HTMLSelectElement).value as 'bar' | 'beat' | 'off')}>
              <option value="bar">小節の頭</option>
              <option value="beat">拍</option>
              <option value="off">合わせない</option>
            </select>
          </label>
          {hasAudio && <label class="check follow"><input type="checkbox" checked={follow} onChange={(e) => setFollow((e.currentTarget as HTMLInputElement).checked)} />再生中の区間を追って表示</label>}
        </div>
        {confirmReset && (
          <div class="confirm">
            <p>区間の区切り・名前・繰り返し・小節数・区間のメモと、テンポ・拍子・最初の小節頭の手動修正をすべて捨てて、自動解析の結果に戻します。曲名・アーティスト・全体メモは残ります。戻したあとでも「元に戻す」で取り消せます。</p>
            <button class="danger" onClick={() => { edit((s) => M.resetToAnalysis(s)); setConfirmReset(false); setSelected(null); setNotice('自動解析の結果に戻しました。'); }}>自動解析の結果に戻す</button>
            <button onClick={() => setConfirmReset(false)}>キャンセル</button>
          </div>
        )}
        {!song.sections.length && <p class="sub">区間がありません。「末尾に区間を追加」から作るか、音源を選んでください。</p>}
        <ol class="section-list">
          {song.sections.map((s, i) => (
            <li key={s.id} ref={(el) => { if (el) rows.current.set(s.id, el); else rows.current.delete(s.id); }}
              class={`section tone-${groupTone(s.group)}${current === s.id ? (playing ? ' now playing' : ' now') : ''}`} onClick={() => setSelected(s.id)}>
              {current === s.id && <div class="now-label">{playing ? '▶ 再生中' : '■ 再生位置'}・{fmt(now)}</div>}
              <div class="sec-main">
                {/* 区間番号。「音源とのずれを合わせる」で区間を選ぶときの目印にする */}
                <span class="sec-no" title={`区間${i + 1}`}>{i + 1}</span>
                <span class="chip" aria-hidden="true" />
                <input class="name" value={s.name} maxLength={200} aria-label={`区間${i + 1}の名前`}
                  onInput={(e) => edit((x) => M.patchSection(x, s.id, { name: (e.currentTarget as HTMLInputElement).value }), { coalesce: `name-${s.id}` })} />
                {hintFor(s) && (
                  <button class="small hint" title="繰り返し・並び・音量から推定した候補です"
                    onClick={() => edit((x) => M.patchSection(x, s.id, { name: hintFor(s)! }))}>候補：{hintFor(s)}</button>
                )}
                <select class="name-preset" aria-label="名前の候補から選ぶ" value="" onChange={(e) => {
                  const el = e.currentTarget as HTMLSelectElement;
                  if (el.value) edit((x) => M.patchSection(x, s.id, { name: el.value }));
                  el.value = '';
                }}>
                  <option value="">名前を選ぶ</option>
                  {M.SECTION_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select aria-label="繰り返し" title="同じ内容の区間に同じ記号を付けます" value={s.group ?? ''} onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  edit((x) => M.setGroup(x, s.id, v === '' ? null : v));
                }}>
                  {groups.map((g) => <option key={g} value={g}>繰り返し{g}</option>)}
                  <option value="new">新しい繰り返し</option>
                  <option value="">繰り返しなし</option>
                </select>
                <span class={`origin ${s.edited ? 'manual' : ''}`}>{s.edited ? '手動修正' : '自動'}</span>
              </div>
              <div class="sec-time">
                {i === 0 ? <span class="t">{fmt(s.start)}</span> : (
                  <span class="t-edit">
                    <button class="tiny" aria-label="開始を早める" onClick={() => edit((x) => M.moveBoundary(x, i, s.start - step))}>−</button>
                    <TimeInput value={s.start} onChange={(t) => t != null && edit((x) => M.moveBoundary(x, i, snapT(t, prevStart(x, i))))} />
                    <button class="tiny" aria-label="開始を遅らせる" onClick={() => edit((x) => M.moveBoundary(x, i, s.start + step))}>＋</button>
                    {hasAudio && <button class="tiny" title="開始位置を再生位置に合わせる" onClick={() => edit((x) => M.moveBoundary(x, i, snapT(now, prevStart(x, i))))}>⇤</button>}
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
                <div class="sec-actions">
                  {hasAudio && (playing && current === s.id
                    ? <button class="small row-play on" onClick={togglePlay}>停止</button>
                    : <button class="small row-play" onClick={() => playSection(s)}>{current === s.id && resumeAt(s) != null ? `${fmt(now)}から再生` : 'ここから再生'}</button>)}
                  {hasAudio && <button class={`small${loopId === s.id ? ' on' : ''}`} onClick={() => toggleLoop(s)}>{loopId === s.id ? 'ループ解除' : 'ループ'}</button>}
                  <button class={`small ghost${splitForm?.id === s.id ? ' on' : ''}`} onClick={() => (splitForm?.id === s.id ? setSplitForm(null) : openSplit(s))}>分割</button>
                  {i < song.sections.length - 1 && <button class="small ghost" onClick={() => edit((x) => M.mergeWithNext(x, s.id))}>次と結合</button>}
                  {song.sections.length > 1 && <button class="small ghost danger" onClick={() => edit((x) => M.deleteSection(x, s.id))}>削除</button>}
                </div>
              </div>
              {hasAudio && <SeekBar range={{ start: s.start, end: s.end }} now={now} onSeek={seekTo} label={`${s.name}の再生位置`} />}
              <input class="memo" value={s.memo} maxLength={2000} placeholder="メモ（入り・キメ・終わり方など）" aria-label="メモ"
                onInput={(e) => edit((x) => M.patchSection(x, s.id, { memo: (e.currentTarget as HTMLInputElement).value }), { coalesce: `memo-${s.id}` })} />
              {splitForm?.id === s.id && (
                <form class="split-form" onSubmit={(e) => { e.preventDefault(); submitSplit(s); }}>
                  <label class="inline">先頭から
                    <input type="number" inputMode="numeric" min={1} value={splitForm.bars} autoFocus
                      onInput={(e) => setSplitForm({ ...splitForm, bars: (e.currentTarget as HTMLInputElement).value, error: '' })} />
                    小節で分割
                  </label>
                  <span class="sub">（この区間は {s.barsManual ?? s.barsEst} 小節。分けた位置は小節の頭に合わせます）</span>
                  <button class="small primary" type="submit">分割する</button>
                  <button class="small" type="button" onClick={() => setSplitForm(null)}>キャンセル</button>
                  {splitForm.error && <p class="error">{splitForm.error}</p>}
                </form>
              )}
            </li>
          ))}
        </ol>
        <p class="sub section-note">削除した区間は直前の区間（先頭の場合は直後）に結合されます。音源は変更されません。</p>
        <div class="text-tools">
          <ExportText song={song} />
          {!importing && <button class="small" onClick={() => setImporting(true)}>テキストから読み込む</button>}
        </div>
        {importing && (
          <ImportText song={song} duration={hasAudio ? media().duration : undefined}
            onClose={() => setImporting(false)}
            onImport={(s) => { edit(() => s); setImporting(false); setSelected(null); setNotice('テキストから構成を読み込みました（「元に戻す」で取り消せます）。'); }} />
        )}
      </section>

      <section class="card">
        <h2>全体メモ</h2>
        <textarea rows={3} maxLength={2000} value={song.memo} placeholder="曲全体についてのメモ（キー、カウントの出し方など）"
          onInput={(e) => edit((s) => ({ ...s, memo: (e.currentTarget as HTMLTextAreaElement).value }), { coalesce: 'memo' })} />
      </section>

      {id && meta && session && role === 'edit' && (
        <section class="card">
          <p class="sub">編集キーで編集しています。構成の編集と保存ができます。削除や共有の管理は、管理キーを持つ人（作成者）だけができます。</p>
          {/* 見てもらうだけのときは、曲名と閲覧 URL を送る（編集キーは入れない）。共有が無効なときは出さない */}
          {meta.viewId && <ShareButtons text={() => shareMessage(song.title, song.artist, viewUrl(meta.viewId!))} />}
        </section>
      )}
      {id && meta && session && role === 'admin' && (
        <Manage id={id} title={song.title} artist={song.artist} meta={meta} session={session}
          onMeta={setMeta}
          onSession={(s) => { L.setSession(id, s, L.remembersSession(id)); setSessionState(s); }}
          onDeleted={async () => { await L.removeDraft(draftKey); L.forgetMine(id); L.forgetKeys(id); go('#/', true); }} />
      )}

      {needKey && song && <KeyForm inline onSubmit={submitKey} />}

      <footer class="savebar">
        {id && (
          <div class="save-opts">
            <input value={note} maxLength={500} placeholder="変更メモ（任意・閲覧ページに表示）" onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
            <label class="check"><input type="checkbox" checked={!notify} onChange={(e) => setNotify(!(e.currentTarget as HTMLInputElement).checked)} />変更として知らせない</label>
          </div>
        )}
        {hasAudio && <SeekBar compact now={now} duration={media().duration} onSeek={seekTo} />}
        <div class="save-row">
          {hasAudio && (
            <span class="mini-player">
              <button class={`small${playing ? ' on' : ''}`} onClick={togglePlay} aria-label={playing ? '一時停止' : '再生'}>{playing ? '■ 停止' : '▶ 再生'}</button>
              <span class="time">{fmt(now)}</span>
              {currentSection && <span class="mini-section">{currentSection.name}</span>}
            </span>
          )}
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
            <button onClick={() => void reloadLatest()}>最新の内容を読み込む（この変更は破棄）</button>
            <button class="danger" onClick={() => void save(true)}>この内容で上書き保存</button>
          </div>
        )}
      </footer>
    </main>
  );
}
