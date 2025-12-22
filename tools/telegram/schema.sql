PRAGMA journal_mode=WAL;

PRAGMA synchronous=NORMAL;



CREATE TABLE IF NOT EXISTS tg_chats (

  chat_id    TEXT PRIMARY KEY,

  chat_name  TEXT,

  chat_type  TEXT,

  chat_index INTEGER

);



CREATE TABLE IF NOT EXISTS tg_norm (

  chat_id       TEXT NOT NULL,

  message_id    INTEGER NOT NULL,

  ts_ms         INTEGER,

  from_name     TEXT,

  from_id       TEXT,

  type          TEXT,

  is_service    INTEGER NOT NULL DEFAULT 0,

  text          TEXT,

  links_json    TEXT,

  norm_json     TEXT NOT NULL,

  chat_name     TEXT,

  PRIMARY KEY (chat_id, message_id)

);



CREATE TABLE IF NOT EXISTS tg_quarantine (

  chat_id       TEXT,

  chat_name     TEXT,

  message_id    INTEGER,

  ts_ms         INTEGER,

  error_code    TEXT NOT NULL,

  error_message TEXT NOT NULL,

  raw_json      TEXT NOT NULL

);



CREATE INDEX IF NOT EXISTS idx_tg_norm_ts ON tg_norm(ts_ms);

CREATE INDEX IF NOT EXISTS idx_tg_norm_from ON tg_norm(from_id);

CREATE INDEX IF NOT EXISTS idx_tg_quarantine_code ON tg_quarantine(error_code);

