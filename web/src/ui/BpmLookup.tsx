import { useEffect, useRef, useState } from 'preact/hooks';
import { api, track, type BpmCandidate } from '../api';
import { errorText } from './util';

type Props = {
  title: string;
  artist: string;
  bpmEst: number | null; // 解析による推定値
  bpm: number | null; // 現在使っている値
  onApply: (bpm: number) => void;
  onResult?: (candidates: BpmCandidate[]) => void; // 検索が終わったら候補を知らせる（倍・半分の判定に使う）
};

type State = { status: 'idle' | 'loading' | 'done' | 'error'; candidates: BpmCandidate[]; sources: string[]; error?: string };

// 解析の推定値との関係（倍・半分の誤認に気づけるようにする）
function relation(bpm: number, est: number | null): string {
  if (!est) return '';
  const r = bpm / est;
  if (Math.abs(r - 1) < 0.03) return '解析結果とほぼ同じ';
  if (Math.abs(r - 1) <= 0.1) return '解析結果に近い';
  if (Math.abs(r - 2) < 0.06) return '解析結果の約2倍';
  if (Math.abs(r - 0.5) < 0.015) return '解析結果の約半分';
  if (Math.abs(r - 1.5) < 0.045 || Math.abs(r - 2 / 3) < 0.02) return '解析結果の約3:2';
  return '解析結果と異なる';
}

// 曲名・アーティスト名からネット上の BPM 情報を調べ、候補として示す。自動では書き換えない
export function BpmLookup({ title, artist, bpmEst, bpm, onApply, onResult }: Props) {
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
      if (last.current === key) {
        setState({ status: 'done', candidates: r.candidates, sources: r.sources });
        onResult?.(r.candidates);
      }
    } catch (e) {
      if (last.current === key) setState({ status: 'error', candidates: [], sources: [], error: errorText(e, '調べられませんでした') });
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
        <strong class="sub-title">ネット上のBPM</strong>
        <button class="small" disabled={!title.trim() || state.status === 'loading'} onClick={() => void lookup(true)}>
          {state.status === 'loading' ? '調べています…' : '調べ直す'}
        </button>
      </div>
      {!title.trim() && <p class="sub">曲名を入れると、ネット上のBPMを調べます。</p>}
      {state.status === 'error' && <p class="error">{state.error}</p>}
      {state.status === 'done' && !state.candidates.length && <p class="sub">見つかりませんでした。曲名・アーティスト名の表記を変えると見つかる場合があります。</p>}
      {state.candidates.length > 0 && !artist.trim() && <p class="warn">アーティスト名を入れると絞り込めます（同じ曲名の別の曲が混ざることがあります）。</p>}
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
        曲名・アーティスト名だけで検索（音源は送りません）。別の録音の値のこともあります。
        提供：<a href="https://getsongbpm.com" target="_blank" rel="noopener">GetSongBPM</a>・Deezer
      </p>
    </div>
  );
}
