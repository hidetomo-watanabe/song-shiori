import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type VideoCandidate } from '../api';
import { fmt } from './util';

type Track = { title: string; artist: string; seconds: number; url: string };
type Props = {
  title: string;
  artist: string;
  duration: number | null; // 選んでいる音源の長さ（別バージョンかの目安）
  onPick: (t: { title: string; artist: string }) => void;
  onPickVideo: (id: string) => void; // YouTube の動画を再生に使う
};

// 曲を検索：YouTube の動画と、iTunes の曲を探し、候補から選んでもらう。YouTube の動画を先に出す。
// YouTube はサーバー経由（API キーをサーバーだけに置くため）、iTunes はライブのしおりと同じくブラウザから直接呼ぶ。
// 押したときだけ曲名・アーティスト名を Google・Apple に送る。候補を選ばなくても、入力した曲名・アーティストのまま使える
export function SongLookup({ title, artist, duration, onPick, onPickVideo }: Props) {
  const [results, setResults] = useState<Track[] | null>(null);
  const [videos, setVideos] = useState<VideoCandidate[] | null>(null);
  const [status, setStatus] = useState('');
  const searched = useRef('');

  // 検索したあとに曲名・アーティストを書き換えたら、古い候補と案内は消す
  useEffect(() => {
    if (searched.current && searched.current !== `${title}\n${artist}`) close();
  }, [title, artist]);

  function close() {
    searched.current = '';
    setResults(null);
    setVideos(null);
    setStatus('');
  }

  async function itunes(term: string): Promise<Track[]> {
    const q = new URLSearchParams({ term, country: 'JP', media: 'music', entity: 'song', limit: '5', lang: 'ja_jp' });
    const res = await fetch(`https://itunes.apple.com/search?${q}`, { referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error();
    const list: any[] = ((await res.json()) as { results?: any[] }).results ?? [];
    return list
      .filter((x) => x.trackName)
      .map((x) => ({
        title: String(x.trackName).slice(0, 200),
        artist: String(x.artistName ?? '').slice(0, 200),
        seconds: Math.round((x.trackTimeMillis ?? 0) / 1000),
        url: /^https:\/\/(music|itunes)\.apple\.com\//.test(x.trackViewUrl ?? '') ? x.trackViewUrl : '',
      }));
  }

  async function search() {
    const term = `${title} ${artist}`.trim();
    if (!term) return;
    setStatus('検索しています…');
    setResults(null);
    setVideos(null);
    searched.current = `${title}\n${artist}`;
    // どちらかが失敗しても、もう一方の結果は出す
    const [yt, it] = await Promise.allSettled([api.youtube(title, artist), itunes(term)]);
    if (searched.current !== `${title}\n${artist}`) return;
    const v = yt.status === 'fulfilled' ? yt.value.videos : [];
    const t = it.status === 'fulfilled' ? it.value : [];
    setVideos(v);
    setResults(t);
    if (yt.status === 'rejected' && it.status === 'rejected') setStatus('検索できませんでした。時間をおいて試してください。');
    else if (!v.length && !t.length) setStatus('見つかりませんでした。入力した曲名・アーティストのままで続けられます。');
    else setStatus('');
  }

  const lengthTag = (s: number) => (duration && s && Math.abs(duration - s) > 5 ? <span class="tag">音源と長さが違います</span> : null);
  const any = !!(videos?.length || results?.length);

  return (
    <div class="song-lookup">
      <button class="small" disabled={!`${title}${artist}`.trim()} onClick={() => void search()}>曲を検索</button>
      {status && <span class="sub">{status}</span>}
      {any && (
        <ul class="lookup-results">
          {videos?.map((v) => (
            <li key={`yt-${v.id}`}>
              <div>
                <span class="tag">YouTube</span> <b>{v.title}</b>
                <span class="sub"> {v.channel}{v.seconds ? `・${fmt(v.seconds, 0)}` : ''}</span>
                {lengthTag(v.seconds)}
                <a class="sub" href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer"> YouTube で見る</a>
              </div>
              <button class="small" onClick={() => { onPickVideo(v.id); close(); setStatus(`再生に「${v.title}」の動画を使います。`); }}>この動画にする</button>
            </li>
          ))}
          {results?.map((t) => (
            <li key={`it-${t.title}-${t.artist}-${t.seconds}`}>
              <div>
                <b>{t.title}</b>
                <span class="sub"> {t.artist}{t.seconds ? `・${fmt(t.seconds, 0)}` : ''}</span>
                {lengthTag(t.seconds)}
                {t.url && <a class="sub" href={t.url} target="_blank" rel="noopener noreferrer"> Apple Music で見る</a>}
              </div>
              <button class="small" onClick={() => { onPick(t); searched.current = `${t.title}\n${t.artist}`; setResults(null); setVideos(null); setStatus(`曲名を「${t.title}」、アーティストを「${t.artist}」にしました。`); }}>これにする</button>
            </li>
          ))}
          <li class="lookup-none">
            <span class="sub">YouTube と iTunes の検索結果より。曲名・アーティスト名だけを Google・Apple に送ります。動画を選ぶと再生に使い、曲を選ぶと曲名・アーティストを入れます。</span>
            <button class="small" onClick={close}>どれでもない（入力のまま使う）</button>
          </li>
        </ul>
      )}
      {status && !any && status !== '検索しています…' && <button class="link sub" onClick={close}>閉じる</button>}
    </div>
  );
}
