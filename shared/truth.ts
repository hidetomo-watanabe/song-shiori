// 検証用の「正しい構成」のテキスト形式（検証音源フォルダの README と同じ書き方）。
//   # BPM: 148.8
//   # 拍子: 4/4
//   0:01.48 イントロ 2小節
// 1行に1区間。区間の始まりの時刻と区間名、必要なら小節数。区間の終わりは次の行の始まり
import type { Song } from './song';

export type TruthSection = { start: number; end: number; name: string; bars: number | null };
export type Truth = { bpm: number | null; beatsPerBar: number | null; duration: number | null; sections: TruthSection[] };

const time = (t: number) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};

// 曲メモを正解ファイルの形にする（人が直した構成をそのまま正解として書き出す）
export function songToTruth(song: Song): string {
  const bpm = song.bpmManual ?? song.bpmEst;
  const lines = [
    `# ${[song.title || '曲名未入力', song.artist].filter(Boolean).join(' / ')}`,
    `# BPM: ${bpm ?? ''}`,
    `# 拍子: ${song.beatsPerBar}/${song.beatsPerBar === 6 || song.beatsPerBar === 7 ? 8 : 4}`,
    `# 長さ: ${time(song.duration)}`,
  ];
  for (const s of song.sections) {
    const bars = s.silence ? null : s.barsManual ?? s.barsEst;
    lines.push(`${time(s.start)} ${s.silence ? '無音' : s.name.replace(/\s+/g, '')}${bars != null ? ` ${bars}小節` : ''}`);
  }
  return lines.join('\n') + '\n';
}

const parseTime = (s: string) => {
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : null;
};

export function parseTruth(text: string): Truth {
  let bpm: number | null = null, beatsPerBar: number | null = null, duration: number | null = null;
  const rows: { start: number; name: string; bars: number | null }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const meta = raw.match(/^#\s*(BPM|拍子|長さ)\s*[:：]\s*(\S+)/);
    if (meta) {
      if (meta[1] === 'BPM') bpm = Number(meta[2]) || null;
      if (meta[1] === '拍子') beatsPerBar = Number(meta[2].split('/')[0]) || null;
      if (meta[1] === '長さ') duration = parseTime(meta[2]);
      continue;
    }
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [t, name = '', barsText] = line.split(/\s+/);
    const start = parseTime(t);
    if (start == null) continue;
    const bars = barsText?.match(/^(\d+)小節$/) ? Number(barsText.replace('小節', '')) : null;
    rows.push({ start, name, bars });
  }
  rows.sort((a, b) => a.start - b.start);
  const sections = rows.map((r, i) => ({ ...r, end: rows[i + 1]?.start ?? duration ?? r.start }));
  return { bpm, beatsPerBar, duration, sections };
}
