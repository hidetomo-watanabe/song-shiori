-- 曲メモ本体。構成データは版ごとに memo_versions に持つ
CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  view_id TEXT UNIQUE,              -- 閲覧識別子。共有を無効化すると NULL
  key_hash TEXT NOT NULL,           -- 秘密キーの SHA-256
  key_gen INTEGER NOT NULL DEFAULT 1,
  create_request TEXT UNIQUE,       -- 作成リクエストの重複防止
  version INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX memos_expires ON memos(expires_at);

CREATE TABLE memo_versions (
  memo_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  data TEXT NOT NULL,               -- 構成データ（JSON）
  note TEXT NOT NULL DEFAULT '',    -- 変更メモ
  notify INTEGER NOT NULL DEFAULT 1, -- 更新案内の対象とするか
  PRIMARY KEY (memo_id, version)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  memo_id TEXT NOT NULL,
  key_gen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_memo ON sessions(memo_id);

CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  anon TEXT,
  device TEXT,
  duration_ms INTEGER,
  audio_sec REAL,
  error TEXT
);
CREATE INDEX usage_events_at ON usage_events(at);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
