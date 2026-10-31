// キーとリンク（ライブのしおりと同じ形）。画面と API の両方で使う
export const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

// 編集キー（メンバー用）は管理キーと世代から導出する。管理キーを持つ端末ならどれでも編集リンクを出せる（サーバーにはハッシュだけを置く）
export const deriveEditKey = async (adminKey: string, gen: number) => (await sha256(`${adminKey}:edit:${gen}`)).slice(0, 48);

export const isKey = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{48}$/.test(s);
