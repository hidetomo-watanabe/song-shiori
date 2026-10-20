-- 編集キー（メンバー用）を追加する。これまでの秘密キーは管理キーとしてそのまま使う
ALTER TABLE memos ADD COLUMN edit_key_hash TEXT;           -- 編集キーの SHA-256。NULL ならメンバーは編集できない
ALTER TABLE memos ADD COLUMN edit_key_gen INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sessions ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'; -- admin（管理キー）または edit（編集キー）
