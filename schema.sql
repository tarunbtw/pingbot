-- Run this once in the Neon SQL Editor before deploying.

CREATE TABLE IF NOT EXISTS urls (
  id         SERIAL PRIMARY KEY,
  url        TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ping_logs (
  id            SERIAL PRIMARY KEY,
  url_id        INTEGER NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  status_code   INTEGER,
  success       BOOLEAN NOT NULL,
  pinged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_ping_logs_url_id ON ping_logs(url_id);
