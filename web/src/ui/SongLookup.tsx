import { useEffect, useRef, useState } from 'preact/hooks';
import { fmt } from './util';

type Track = { title: string; artist: string; seconds: number; url: string };
type Props = {
  title: string;
  artist: string;
  duration: number | null; // 選んでいる音源の長さ（別バージョンかの目安）
  onPick: (t: { title: string; artist: string }) => void;
};

// 曲を検索：ライブのしおりと同じく iTunes Search API をブラウザから直接呼び、候補から選んでもらう。
// 押したときだけ曲名・アーティスト名を Apple に送る。候補を選ばなくても、入力した曲名・アーティストのまま使える
export function SongLookup({ title, artist, duration, onPick }: Props) {
  const [results, setResults] = useState<Track[] | null>(null);
  const [status, setStatus] = useState('');
  const searched = useRef('');

  // 検索したあとに曲名・アーティストを書き換えたら、古い候補と案内は消す
  useEffect(() => {
    if (searched.current && searched.current !== `${title}\n${artist}`) {
      searched.current = '';
      setResults(null);
      setStatus('');
    }
  }, [title, artist]);

  const close = () => {
    searched.current = '';
    setResults(null);
    setStatus('');
  };

  async function search() {
    const term = `${title} ${artist}`.trim();
    if (!term) return;
    setStatus('検索しています…');
    setResults(null);
    searched.current = `${title}\n${artist}`;
    try {
      const q = new URLSearchParams({ term, country: 'JP', media: 'music', entity: 'song', limit: '5', lang: 'ja_jp' });
      const res = await fetch(`https://itunes.apple.com/search?${q}`, { referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error();
      const list: any[] = ((await res.json()) as { results?: any[] }).results ?? [];
      const found = list
        .filter((x) => x.trackName)
        .map((x) => ({
          title: String(x.trackName).slice(0, 200),
          artist: String(x.artistName ?? '').slice(0, 200),
          seconds: Math.round((x.trackTimeMillis ?? 0) / 1000),
          url: /^https:\/\/(music|itunes)\.apple\.com\//.test(x.trackViewUrl ?? '') ? x.trackViewUrl : '',
        }));
      setResults(found);
      setStatus(found.length ? '' : '見つかりませんでした。入力した曲名・アーティストのままで続けられます。');
    } catch {
      setStatus('検索できませんでした。時間をおいて試してください。');
    }
  }

  return (
    <div class="song-lookup">
      <button class="small" disabled={!`${title}${artist}`.trim()} onClick={() => void search()}>曲を検索</button>
      {status && <span class="sub">{status}</span>}
      {results && results.length > 0 && (
        <ul class="lookup-results">
          {results.map((t) => (
            <li key={`${t.title}-${t.artist}-${t.seconds}`}>
              <div>
                <b>{t.title}</b>
                <span class="sub"> {t.artist}{t.seconds ? `・${fmt(t.seconds, 0)}` : ''}</span>
                {duration && t.seconds && Math.abs(duration - t.seconds) > 5 ? <span class="tag">音源と長さが違います</span> : null}
                {t.url && <a class="sub" href={t.url} target="_blank" rel="noopener noreferrer"> Apple Music で見る</a>}
              </div>
              <button class="small" onClick={() => { onPick(t); searched.current = `${t.title}\n${t.artist}`; setResults(null); setStatus(`曲名を「${t.title}」、アーティストを「${t.artist}」にしました。`); }}>これにする</button>
            </li>
          ))}
          <li class="lookup-none">
            <span class="sub">iTunes の検索結果より。曲名・アーティスト名だけを Apple に送ります。</span>
            <button class="small" onClick={close}>どれでもない（入力のまま使う）</button>
          </li>
        </ul>
      )}
      {status && !results?.length && status !== '検索しています…' && <button class="link sub" onClick={close}>閉じる</button>}
    </div>
  );
}
