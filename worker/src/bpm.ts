// 曲名・アーティスト名から、ネット上の BPM 情報を調べる。音源は使わない
//   1. GetSongBPM（API キーが設定されている場合。利用条件として画面から getsongbpm.com へのリンクが必要）
//   2. Deezer（キー不要。BPM が登録されていない曲が多い）

export type BpmCandidate = { source: 'GetSongBPM' | 'Deezer'; title: string; artist: string; bpm: number; url: string | null };

const TIMEOUT = 5000;
const SKIP = /カラオケ|karaoke|instrumental|オルゴール|music box|cover|カバー/i;

// 表記ゆれ（全角半角・大文字小文字・空白・記号）をならす
export const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const similar = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
};

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fromGetSongBpm(title: string, artist: string, key: string): Promise<BpmCandidate[]> {
  const q = new URLSearchParams(artist ? { type: 'both', lookup: `song:${title} artist:${artist}` } : { type: 'song', lookup: title });
  q.set('api_key', key);
  const data = await getJson(`https://api.getsong.co/search/?${q}`);
  const list: any[] = Array.isArray(data?.search) ? data.search : []; // 該当なしのときは { search: { error } }
  return list
    .map((s) => ({ source: 'GetSongBPM' as const, title: String(s?.title ?? ''), artist: String(s?.artist?.name ?? ''), bpm: Number(s?.tempo), url: typeof s?.uri === 'string' ? s.uri : null }))
    .filter((c) => c.bpm > 0 && similar(c.title, title));
}

async function fromDeezer(title: string, artist: string): Promise<BpmCandidate[]> {
  const q = new URLSearchParams({ q: `${title} ${artist}`.trim(), limit: '10' });
  const data = await getJson(`https://api.deezer.com/search?${q}`);
  const hits: any[] = (Array.isArray(data?.data) ? data.data : [])
    .filter((t: any) => similar(String(t?.title ?? ''), title) && !SKIP.test(String(t?.title ?? '')))
    // 海外アーティストは日本語表記で返ることがあるため、アーティスト名は並べ替えにだけ使う
    .sort((a: any, b: any) => Number(similar(b?.artist?.name ?? '', artist)) - Number(similar(a?.artist?.name ?? '', artist)))
    .slice(0, 3);
  const tracks = await Promise.all(hits.map((t) => getJson(`https://api.deezer.com/track/${Number(t.id)}`).catch(() => null)));
  return tracks
    .filter((t) => t && Number(t.bpm) > 0)
    .map((t) => ({ source: 'Deezer' as const, title: String(t.title), artist: String(t.artist?.name ?? ''), bpm: Math.round(Number(t.bpm) * 10) / 10, url: typeof t.link === 'string' ? t.link : null }));
}

export async function lookupBpm(title: string, artist: string, getSongBpmKey?: string): Promise<{ candidates: BpmCandidate[]; errors: string[] }> {
  const errors: string[] = [];
  const run = async (name: string, fn: () => Promise<BpmCandidate[]>) => {
    try { return await fn(); } catch (e) { errors.push(`${name}: ${e instanceof Error ? e.message : 'error'}`); return []; }
  };
  const [a, b] = await Promise.all([
    getSongBpmKey ? run('GetSongBPM', () => fromGetSongBpm(title, artist, getSongBpmKey)) : Promise.resolve([]),
    run('Deezer', () => fromDeezer(title, artist)),
  ]);
  // 同じ情報源・同じBPMの重複を除き、アーティスト名が一致するものを先にする
  const seen = new Set<string>();
  const candidates = [...a, ...b]
    .filter((c) => { const k = `${c.source}:${c.bpm}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => Number(similar(y.artist, artist)) - Number(similar(x.artist, artist)))
    .slice(0, 5);
  return { candidates, errors };
}
