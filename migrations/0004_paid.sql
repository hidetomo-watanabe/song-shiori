-- 有料の曲メモ（要件書 11.1）。有料の間は期限なし・すべての版を残す。運営者のマイキーで切り替える
ALTER TABLE memos ADD COLUMN paid INTEGER NOT NULL DEFAULT 0;
