// 構成表のテキスト形式。利用者の書き出し（コピー・保存）と、自動解析の検証用の正解データの両方に使う。
//   ゲット・アップ・ルーシー / THEE MICHELLE GUN ELEPHANT
//   BPM 148.8・4/4
//
//   0:00.0 （無音）
//   0:01.5 イントロ 2小節
//   0:05.2 Aメロ 8小節 ｜ドラムは抑えめ
// 1行に1区間。区間の始まりの時刻・区間名・小節数（任意）・「｜」の後ろにメモ（任意）。区間の終わりは次の行の始まり。
// 時刻で始まらない行は見出し（曲名、BPM・拍子、長さ）として扱う。検証音源フォルダの README の書き方（# で始まる行）も読める
import type { Song } from './song';

export type TruthSection = { start: number; end: number; name: string; bars: number | null; memo: string };
export type Truth = {
  title: string; artist: string; memo: string;
  bpm: number | null; beatsPerBar: number | null; duration: number | null; sections: TruthSection[];
};

const time = (t: number) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};
const signature = (n: number) => `${n}/${n === 6 || n === 7 ? 8 : 4}`;
export const SILENCE_LABEL = '（無音）';

export function songToText(song: Song): string {
  const bpm = song.bpmManual ?? song.bpmEst;
  const lines = [
    [song.title || '曲名未入力', song.artist].filter(Boolean).join(' / '),
    [bpm ? `BPM ${bpm}` : 'BPM 未確定', signature(song.beatsPerBar), `長さ ${time(song.duration)}`].join('・'),
    '',
  ];
  for (const s of song.sections) {
    const bars = s.silence ? null : s.barsManual ?? s.barsEst;
    const memo = s.memo.replace(/\s+/g, ' ').trim();
    lines.push([time(s.start), s.silence ? SILENCE_LABEL : s.name.replace(/\s+/g, ''), bars != null ? `${bars}小節` : '', memo ? `｜${memo}` : '']
      .filter(Boolean).join(' '));
  }
  if (song.memo.trim()) lines.push('', song.memo.trim());
  return lines.join('\n') + '\n';
}

const parseTime = (s: string) => {
  const m = s.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : null;
};

export function parseTruth(text: string): Truth {
  let bpm: number | null = null, beatsPerBar: number | null = null, duration: number | null = null;
  let title = '', artist = '';
  const songMemo: string[] = [];
  const rows: { start: number; name: string; bars: number | null; memo: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.split(/\s+/)[0];
    const start = parseTime(head);
    if (start == null) {
      // 見出しの行：BPM・拍子・長さを読む（「BPM 148.8・4/4・長さ 4:38.9」「# BPM: 149」「# 拍子: 4/4」）
      const b = line.match(/BPM\s*[:：]?\s*(\d+(?:\.\d+)?)/);
      if (b) bpm = Number(b[1]);
      const sig = line.match(/(?:拍子\s*[:：]?\s*)?(\d+)\/(4|8)/);
      if (sig) beatsPerBar = Number(sig[1]);
      const d = line.match(/長さ\s*[:：]?\s*(\d+:\d+(?:\.\d+)?)/);
      if (d) duration = parseTime(d[1]);
      if (b || sig || d) continue;
      // 区間より前の最初の行は「曲名 / アーティスト」、区間より後ろの行は全体メモ
      if (!rows.length && !title) {
        const t = line.replace(/^#\s*/, '');
        const at = t.lastIndexOf(' / ');
        [title, artist] = at >= 0 ? [t.slice(0, at), t.slice(at + 3)] : [t, ''];
      } else if (rows.length && !line.startsWith('#')) songMemo.push(line);
      continue;
    }
    const [body, memo = ''] = line.replace(/#.*/, '').split('｜');
    const [, name = '', barsText] = body.trim().split(/\s+/);
    const bars = barsText?.match(/^(\d+)小節$/) ? Number(barsText.replace('小節', '')) : null;
    rows.push({ start, name: name === SILENCE_LABEL ? '無音' : name, bars, memo: memo.trim() });
  }
  rows.sort((a, b) => a.start - b.start);
  const sections = rows.map((r, i) => ({ ...r, end: rows[i + 1]?.start ?? duration ?? r.start }));
  return { title: title === '曲名未入力' ? '' : title, artist, memo: songMemo.join('\n'), bpm, beatsPerBar, duration, sections };
}
