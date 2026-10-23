// 曲名・アーティスト名から、再生に使う YouTube の動画を探す（YouTube Data API v3）。音源は使わない。
// API キーはサーバーだけに置く。検索1回で 100 ユニット（無料枠は1日 10,000）を使うので、結果はキャッシュする

export type VideoCandidate = { id: string; title: string; channel: string; seconds: number };

const TIMEOUT = 5000;
const MAX = 5;

// 失敗したときは、Google が返す理由（keyInvalid・quotaExceeded など）を含める（キーは含めない）
async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: { message?: string; errors?: { reason?: string }[] } } | null;
    throw new Error(`HTTP ${res.status} ${err?.error?.errors?.[0]?.reason ?? ''} ${err?.error?.message ?? ''}`.trim());
  }
  return res.json();
}

// 検索結果の題名は HTML の文字参照（&amp; &#39; など）を含む
const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|#(\d+));/g, (_, n: string, code?: string) =>
    code ? String.fromCharCode(Number(code)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" } as Record<string, string>)[n]);

// ISO 8601 の長さ（PT4M42S など）を秒に
const seconds = (d: string) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? '');
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0) : 0;
};

export async function searchYoutube(title: string, artist: string, rawKey: string): Promise<VideoCandidate[]> {
  const key = rawKey.trim(); // 貼り付けたときに入る前後の空白・改行を除く
  // 埋め込みで再生できる動画だけを探す（閲覧ページ・編集画面のプレーヤーで流すため）
  const q = new URLSearchParams({
    part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(MAX),
    q: `${title} ${artist}`.trim(), regionCode: 'JP', relevanceLanguage: 'ja', key,
  });
  const found = await getJson(`https://www.googleapis.com/youtube/v3/search?${q}`);
  const items: any[] = Array.isArray(found?.items) ? found.items : [];
  const ids = items.map((x) => String(x?.id?.videoId ?? '')).filter((id) => /^[\w-]{11}$/.test(id));
  if (!ids.length) return [];
  // 長さは検索結果に含まれないので、まとめて取り直す（1ユニット）
  const detail = await getJson(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'contentDetails', id: ids.join(','), key })}`).catch(() => null);
  const length = new Map<string, number>((Array.isArray(detail?.items) ? detail.items : []).map((v: any) => [String(v?.id), seconds(String(v?.contentDetails?.duration ?? ''))]));
  return items
    .filter((x) => ids.includes(String(x?.id?.videoId)))
    .map((x) => ({
      id: String(x.id.videoId),
      title: decode(String(x?.snippet?.title ?? '')).slice(0, 200),
      channel: decode(String(x?.snippet?.channelTitle ?? '')).slice(0, 200),
      seconds: length.get(String(x.id.videoId)) ?? 0,
    }));
}
