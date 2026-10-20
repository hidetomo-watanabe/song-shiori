import { useEffect, useRef, useState } from 'preact/hooks';
import { api, track, type BpmCandidate } from '../api';

type Props = {
  title: string;
  artist: string;
  bpmEst: number | null; // 解析による推定値
  bpm: number | null; // 現在使っている値
  onApply: (bpm: number) => void;
};

type State = { status: 'idle' | 'loading' | 'done' | 'error'; candidates: BpmCandidate[]; sources: string[]; error?: string };

// 解析の推定値との関係（倍・半分の誤認に気づけるようにする）
function relation(bpm: number, est: number | null): string {
  if (!est) return '';
  const r = bpm / est;
  if (Math.abs(r - 1) < 0.03) return '解析結果とほぼ同じ';
  if (Math.abs(r - 2) < 0.06) return '解析結果の約2倍';
  if (Math.abs(r - 0.5) < 0.015) return '解析結果の約半分';
  if (Math.abs(r - 1.5) < 0.045 || Math.abs(r - 2 / 3) < 0.02) return '解析結果の約3:2';
  return '解析結果と異なる';
}

// 曲名・アーティスト名からネット上の BPM 情報を調べ、候補として示す。自動では書き換えない
export function BpmLookup({ title, artist, bpmEst, bpm, onApply }: Props) {
  const [state, setState] = useState<State>({ status: 'idle', candidates: [], sources: [] });
  const last = useRef('');

  async function lookup(force = false) {
    const t = title.trim(), a = artist.trim();
    const key = `${t}\n${a}`;
    if (!t || (!force && key === last.current)) return;
    last.current = key;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const r = await api.bpm(t, a);
      if (last.current === key) setState({ status: 'done', candidates: r.candidates, sources: r.sources });
    } catch (e) {
      if (last.current === key) setState({ status: 'error', candidates: [], sources: [], error: e instanceof Error ? e.message : '調べられませんでした' });
    }
  }

  // 曲名・アーティスト名の入力が止まってから自動で調べる
  useEffect(() => {
    const t = setTimeout(() => void lookup(), 1500);
    return () => clearTimeout(t);
  }, [title, artist]);

  return (
    <div class="bpm-lookup">
      <div class="bpm-lookup-head">
        <strong>ネット上のBPM情報</strong>
        <button class="small" disabled={!title.trim() || state.status === 'loading'} onClick={() => void lookup(true)}>
          {state.status === 'loading' ? '調べています…' : '調べ直す'}
        </button>
      </div>
      {!title.trim() && <p class="sub">曲名（とアーティスト名）を入力すると、ネット上のBPM情報を調べます。</p>}
      {state.status === 'error' && <p class="error">{state.error}</p>}
      {state.status === 'done' && !state.candidates.length && <p class="sub">見つかりませんでした。曲名・アーティスト名の表記を変えると見つかる場合があります。</p>}
      {state.candidates.length > 0 && (
        <ul class="bpm-candidates">
          {state.candidates.map((c) => (
            <li key={`${c.source}-${c.bpm}-${c.title}`}>
              <span class="bpm-value">{c.bpm}</span>
              <span class="bpm-meta">
                {c.title} / {c.artist}（{c.url ? <a href={c.url} target="_blank" rel="noopener">{c.source}</a> : c.source}）
                {relation(c.bpm, bpmEst) && <span class="tag">{relation(c.bpm, bpmEst)}</span>}
              </span>
              <button class="small" disabled={bpm === c.bpm} onClick={() => { onApply(c.bpm); track('bpm_lookup_applied'); }}>
                {bpm === c.bpm ? '使用中' : 'このBPMを使う'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="sub">
        曲名・アーティスト名だけで検索します（音源は送りません）。ネット上の情報は別の録音・アレンジの値の場合があります。
        BPM情報：<a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM</a>・Deezer
      </p>
    </div>
  );
}
