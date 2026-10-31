// 運営者の登録：マイキーから、シークレット OPERATORS に入れる値（照合用キーの SHA-256。accounts.id と同じ）を出す
// 使い方：node scripts/operator-id.ts <マイキー>  →  npx wrangler secret put OPERATORS に貼る（複数ならカンマ区切り）
import { sha256 } from '../shared/keys.ts';

const my = process.argv[2] ?? '';
if (!/^[a-f0-9]{48}$/.test(my)) {
  console.error('マイキー（48桁の英数字。#/mine の「マイキー」）を渡してください');
  process.exit(1);
}
const auth = (await sha256(`${my}:account`)).slice(0, 48); // web/src/storage/mykey.ts の accountAuth と同じ
console.log(await sha256(auth));
