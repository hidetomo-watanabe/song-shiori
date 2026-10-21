// 構成表のテキスト形式。利用者の書き出し（コピー・保存）と、自動解析の検証用の正解データの両方に使う。
//   ゲット・アップ・ルーシー / THEE MICHELLE GUN ELEPHANT
//   BPM 148.8・4/4
//
//   0:00.0 （無音）
//   0:01.5 イントロ 2小節
//   0:05.2 Aメロ 8小節 ｜ドラムは抑えめ
//     コード | Am | G | F | E7 |
// 1行に1区間。区間の行の次に「コード」で始まる行があれば、その区間のコード進行。区間の始まりの時刻・区間名・小節数（任意）・「｜」の後ろにメモ（任意）。区間の終わりは次の行の始まり。
// YouTube の動画を使っていれば、見出しに「YouTube https://youtu.be/… ずれ +5.02秒」の行を加える。
// 時刻で始まらない行は見出し（曲名、BPM・拍子、長さ、YouTube）として扱う。検証音源フォルダの README の書き方（# で始まる行）も読める
import { clampOffset, confirmedChords, trimSilence, youtubeId, type Song } from './song.ts';

export type TruthSection = { start: number; end: number; name: string; bars: number | null; memo: string; chords: string | null };
export type Truth = {
  title: string; artist: string; memo: string;
  bpm: number | null; beatsPerBar: number | null; duration: number | null; sections: TruthSection[];
  youtube: string | null; youtubeOffset: number; // YouTube の動画 ID と、構成表の時刻とのずれ（秒）
};

const time = (t: number) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};
const signature = (n: number) => `${n}/${n === 6 || n === 7 ? 8 : 4}`;
export const SILENCE_LABEL = '（無音）';

export function songToText(original: Song): string {
  const song = trimSilence(original);
  const bpm = song.bpmManual ?? song.bpmEst;
  const lines = [
    [song.title || '曲名未入力', song.artist].filter(Boolean).join(' / '),
    [bpm ? `BPM ${bpm}` : 'BPM 未確定', signature(song.beatsPerBar), `長さ ${time(song.duration)}`].join('・'),
  ];
  if (song.youtube) {
    const o = song.youtubeOffset ?? 0;
    lines.push(`YouTube https://youtu.be/${song.youtube}${o ? ` ずれ ${o > 0 ? '+' : ''}${o.toFixed(2)}秒` : ''}`);
  }
  lines.push('');
  for (const s of song.sections) {
    const bars = s.silence ? null : s.barsManual ?? s.barsEst;
    const memo = s.memo.replace(/\s+/g, ' ').trim();
    lines.push([time(s.start), s.silence ? SILENCE_LABEL : s.name.replace(/\s+/g, ''), bars != null ? `${bars}小節` : '', memo ? `｜${memo}` : '']
      .filter(Boolean).join(' '));
    // 推定は書き出さず、手で入れた（確かめた）コード進行だけを書く
    const chords = s.silence ? null : confirmedChords(song, s)?.text.replace(/\s+/g, ' ').trim();
    if (chords) lines.push(`  コード ${chords}`);
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
  let youtube: string | null = null, youtubeOffset = 0;
  const songMemo: string[] = [];
  const rows: { start: number; name: string; bars: number | null; memo: string; chords: string | null }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.split(/\s+/)[0];
    const start = parseTime(head);
    if (start == null) {
      // 区間の行の次の「コード | Am | G |」は、その区間のコード進行
      const ch = line.match(/^コード\s*[:：]?\s*(.*)$/);
      if (ch && rows.length) { rows[rows.length - 1].chords = ch[1].trim() || null; continue; }
      // YouTube の行（URL に「/」や数字が入るため、BPM・拍子より先に読む）
      const y = line.match(/^#?\s*YouTube\s*[:：]?\s*(\S+)(?:\s*ずれ\s*[:：]?\s*([+\-−]?\d+(?:\.\d+)?)\s*秒)?/i);
      if (y && youtubeId(y[1])) {
        youtube = youtubeId(y[1]);
        youtubeOffset = y[2] ? clampOffset(Number(y[2].replace('−', '-'))) : 0;
        continue;
      }
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
    rows.push({ start, name: name === SILENCE_LABEL ? '無音' : name, bars, memo: memo.trim(), chords: null });
  }
  rows.sort((a, b) => a.start - b.start);
  const sections = rows.map((r, i) => ({ ...r, end: rows[i + 1]?.start ?? duration ?? r.start }));
  return { title: title === '曲名未入力' ? '' : title, artist, memo: songMemo.join('\n'), bpm, beatsPerBar, duration, sections, youtube, youtubeOffset };
}
