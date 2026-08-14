export const JOBS_MIGRATION_001 = `-- Durable job queue schema v1 (#628)
-- Separate SQLite file from disposable collector.db index.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  available_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_active
  ON jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status IN ('pending', 'running');

CREATE INDEX IF NOT EXISTS jobs_poll
  ON jobs(status, available_at, priority DESC, created_at);
`;
