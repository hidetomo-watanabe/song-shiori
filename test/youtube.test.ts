import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchYoutube } from '../worker/src/youtube';

afterEach(() => vi.unstubAllGlobals());

describe('YouTube の動画の検索', () => {
  it('検索結果と長さをまとめ、題名の文字参照を戻す', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url);
      const body = url.includes('/search?')
        ? { items: [
          { id: { videoId: 'HEkWqvM6tQ8' }, snippet: { title: 'RCサクセション - 雨あがりの夜空に (Official Video) &amp; Live', channelTitle: 'RC&#39;s' } },
          { id: { videoId: 'bad' }, snippet: { title: '壊れたID' } },
        ] }
        : { items: [{ id: 'HEkWqvM6tQ8', contentDetails: { duration: 'PT4M42S' } }] };
      return new Response(JSON.stringify(body));
    });
    const v = await searchYoutube('雨あがりの夜空に', 'RCサクセション', 'KEY');
    expect(v).toEqual([{ id: 'HEkWqvM6tQ8', title: 'RCサクセション - 雨あがりの夜空に (Official Video) & Live', channel: "RC's", seconds: 282 }]);
    // 埋め込みで再生できる動画だけを、曲名とアーティスト名で探す
    expect(calls[0]).toContain('videoEmbeddable=true');
    expect(decodeURIComponent(calls[0].replace(/\+/g, ' '))).toContain('q=雨あがりの夜空に RCサクセション');
    expect(calls[1]).toContain('id=HEkWqvM6tQ8');
  });

  it('長さを取れなくても、検索結果は返す', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.includes('/search?')
        ? new Response(JSON.stringify({ items: [{ id: { videoId: 'HEkWqvM6tQ8' }, snippet: { title: 't', channelTitle: 'c' } }] }))
        : new Response('', { status: 500 }));
    expect(await searchYoutube('t', '', 'KEY')).toEqual([{ id: 'HEkWqvM6tQ8', title: 't', channel: 'c', seconds: 0 }]);
  });
});
