# 曲のしおり（試作版）

音源から曲の構成（区切り・繰り返し・小節数）を下書きし、聴きながら直して、バンドメンバーと共有するWebアプリ。
要件は `../../whathides/曲のしおり/song-structure-requirements.md`（1.4）を参照。

- 画面：Vite + Preact + TypeScript（`web/`）。GitHub Pages で公開する想定
- 自動解析：ブラウザ内の Web Worker（`web/src/analysis/`）。音源はサーバーへ送らない
- API：Cloudflare Workers + D1（`worker/`、`migrations/`）
- 構成データと編集ルール・差分計算：`shared/`（画面と API で共用）

## ローカルで動かす

```bash
npm install
npm run db:migrate:local   # 初回のみ：ローカルの D1 を作る
npm run dev:api            # API（http://127.0.0.1:8787）
npm run dev                # 画面（http://localhost:5173）。/api は API へ中継される
API_PROXY=https://song-shiori-api.whathides.workers.dev npm run dev  # /api を本番の API へ中継する（ネット上の BPM の確認など）
```

## 確認用のコマンド

```bash
npm test                                   # 編集ルール・差分計算のテスト
node scripts/api-smoke.ts                  # API の主要操作をローカルで確認（dev:api の起動が必要）
node scripts/analyze-raw.ts <file.f32>     # 22050Hz モノラル float32 の生データを解析して表示
node scripts/evaluate.ts [フォルダ]        # 検証音源フォルダの全曲を解析し、正解ファイル（曲名.txt）と比べる（音源の読み込みに Python の librosa が必要）
```

## 公開の構成

| 役割 | 公開先 | URL |
| --- | --- | --- |
| 画面 | GitHub Pages（`main` への push で GitHub Actions が公開） | https://song-shiori.whathides.co.jp |
| API | Cloudflare Workers（`npm run deploy:api` で手元から公開） | https://song-shiori-api.whathides.workers.dev |
| データ | Cloudflare D1（`kyoku-shiori`） | |

- DB の変更：`npx wrangler d1 migrations apply kyoku-shiori --remote`
- シークレット：`SALT`（設定済み）、`GETSONGBPM_KEY`（https://getsongbpm.com/api で無料登録。未設定なら Deezer のみで検索）
  - 設定は `npx wrangler secret put GETSONGBPM_KEY`。ローカルでは `.dev.vars` に書く
- GitHub のリポジトリ変数 `API_BASE` に API の URL を設定する（画面のビルドで使う）
- `web/public/CNAME` が独自ドメイン（song-shiori.whathides.co.jp）。DNS に `song-shiori` → `hidetomo-watanabe.github.io` の CNAME が必要
- BPM 検索結果は Cache API で7日間キャッシュする（情報源が変わったら別の結果として扱う）
