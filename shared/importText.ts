// テキスト（構成表の書き出し）から曲メモの構成を作る
import { emptySong, MIN_SECTION, newSection, normalize, trimSilence, type Section, type Song } from './song.ts';
import { parseTruth } from './truth.ts';

export type Imported = { song: Song; warnings: string[] };

// 「サビ（2回目）」「Aメロ2」などの繰り返しの番号を外した名前
const baseName = (n: string) => n.replace(/（\d+回目）$/, '').replace(/\(\d+回目\)$/, '').trim();

// base：いまの曲メモ（音源の長さ・解析の結果などを引き継ぐ）。duration：音源を選んでいればその長さ
export function songFromText(text: string, base: Song = emptySong(), duration?: number): Imported {
  const t = parseTruth(text);
  const warnings: string[] = [];
  const rows = t.sections.filter((s) => s.name || s.bars != null);
  if (!rows.length) return { song: base, warnings: ['区間が読み取れませんでした。「0:05.2 Aメロ 8小節」のように、1行に1区間を書いてください。'] };
  const end = duration ?? t.duration ?? (base.duration > rows[rows.length - 1].start ? base.duration : null);
  const bpm = t.bpm ?? base.bpmManual ?? base.bpmEst;
  const lastLen = rows[rows.length - 1].bars && bpm ? (rows[rows.length - 1].bars! * 60 * (t.beatsPerBar ?? 4)) / bpm : 8;
  const total = end ?? rows[rows.length - 1].start + lastLen;
  if (duration != null && t.duration != null && Math.abs(duration - t.duration) > 1) {
    warnings.push(`テキストの曲の長さ（${t.duration.toFixed(1)}秒）と音源の長さ（${duration.toFixed(1)}秒）が違います。別の音源の構成かもしれません。`);
  }
  // 時刻順に区間を作る。曲頭に空きがあれば無音の区間にし、曲の長さを超える区間は落とす
  const sections: Section[] = [];
  if (rows[0].start > MIN_SECTION) sections.push(newSection(0, rows[0].start, { name: '無音（曲の前）', nameAuto: false, silence: true }));
  const firstStart = sections.length ? rows[0].start : 0;
  const groupOf = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(baseName(r.name), (counts.get(baseName(r.name)) ?? 0) + 1);
  rows.forEach((r, i) => {
    const start = i === 0 ? firstStart : r.start;
    const stop = Math.min(i + 1 < rows.length ? rows[i + 1].start : total, total);
    if (stop - start < MIN_SECTION) { warnings.push(`${r.name || '区間'}（${r.start.toFixed(1)}秒）は曲の長さを超えるか短すぎるため、読み込みませんでした。`); return; }
    if (r.name === '無音') {
      sections.push(newSection(start, stop, { name: i === 0 ? '無音（曲の前）' : '無音（曲の後）', nameAuto: false, silence: true, memo: r.memo }));
      return;
    }
    // 同じ名前（「Aメロ」「Aメロ（2回目）」）が2回以上出る区間は、同じ繰り返しにする
    const key = baseName(r.name);
    let group: string | null = null;
    if (key && (counts.get(key) ?? 0) > 1) {
      if (!groupOf.has(key)) groupOf.set(key, String.fromCharCode(65 + Math.min(groupOf.size, 25)));
      group = groupOf.get(key)!;
    }
    sections.push(newSection(start, stop, { name: r.name || 'パート', nameAuto: !r.name, group, groupManual: !!group, memo: r.memo, edited: true }));
  });
  if (!sections.length) return { song: base, warnings };
  let song: Song = {
    ...base,
    title: t.title || base.title,
    artist: t.artist || base.artist,
    memo: t.memo || base.memo,
    duration: sections[sections.length - 1].end,
    beatsPerBar: t.beatsPerBar ?? base.beatsPerBar,
    // BPM は推定と同じなら推定のまま、違えば手入力の値として入れる
    bpmManual: t.bpm != null && (base.bpmEst == null || Math.abs(t.bpm / base.bpmEst - 1) > 0.005) ? t.bpm : base.bpmManual,
    // YouTube の動画はテキストに書かれていればそれを使い、なければ今の動画のまま
    youtube: t.youtube ?? base.youtube,
    youtubeOffset: t.youtube ? t.youtubeOffset || undefined : base.youtubeOffset,
    groupNames: Object.fromEntries([...groupOf].map(([name, g]) => [g, name])),
    sections,
  };
  song = normalize(song);
  // 書かれていた小節数が、拍から数えた小節数と違う区間だけ、手入力の小節数として残す
  song = normalize({
    ...song,
    sections: song.sections.map((s, i) => {
      const r = rows.find((x) => Math.abs((i === 0 && sections.length === rows.length ? firstStart : x.start) - s.start) < 0.05 && !s.silence);
      return r?.bars != null && r.bars !== s.barsEst ? { ...s, barsManual: r.bars } : s;
    }),
  });
  // 以前の形式のテキスト（「（無音）」の行がある、時刻が音源ファイルの時刻）は、曲の頭を 0:00 にそろえる。
  // 曲頭の無音の長さを音源ファイルのずれにし、テキストに書かれた YouTube のずれも同じだけ動かす
  if (song.sections.some((s) => s.silence)) {
    const youtubeOffset = song.youtubeOffset;
    song = trimSilence({ ...song, audio: base.audio ? { offset: 0, duration: base.audio.duration } : null });
    if (!t.youtube) song = { ...song, youtubeOffset };
  }
  return { song, warnings };
}
