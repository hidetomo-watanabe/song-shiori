-- キーをリンクで渡し、毎回キーそのもので確かめる（ライブのしおりと同じ）。編集セッションは使わない
DROP TABLE sessions;

-- マイキー：端末間で揃えるキーの一覧。画面側でマイキーから作った鍵で暗号化してあり、サーバーは中身を読めない
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,              -- 照合用キー（マイキーから導出）の SHA-256
  data TEXT,                        -- 暗号化した一覧（base64）。削除済みなら NULL
  revision INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, -- 削除済みの印。同じマイキーを持つ別の端末の同期で作り直さない
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX accounts_expires ON accounts(expires_at);
