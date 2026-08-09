import Database from 'better-sqlite3';
import { DB_PATH, ensureDirs } from './paths';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'pushing'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface RepoRow {
  id: string;
  owner: string;
  name: string;
  default_branch: string;
  installation_id: number;
  created_at: string;
}

export interface TaskRow {
  id: string;
  repo_id: string;
  title: string;
  branch: string;
  base_branch: string;
  status: TaskStatus;
  model: string | null;
  session_id: string | null;
  auto_push: number;
  commit_message: string | null;
  pushed_sha: string | null;
  error: string | null;
  source: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TurnRow {
  id: string;
  task_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  task_id: string;
  kind: string;
  payload: string;
  created_at: string;
}

export interface WebhookTokenRow {
  id: string;
  name: string;
  token_hash: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repos (
  id              TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,
  name            TEXT NOT NULL,
  default_branch  TEXT NOT NULL DEFAULT 'main',
  installation_id INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (owner, name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id             TEXT PRIMARY KEY,
  repo_id        TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  branch         TEXT NOT NULL,
  base_branch    TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  model          TEXT,
  session_id     TEXT,
  auto_push      INTEGER NOT NULL DEFAULT 1,
  commit_message TEXT,
  pushed_sha     TEXT,
  error          TEXT,
  source         TEXT NOT NULL DEFAULT 'dashboard',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  started_at     TEXT,
  finished_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_turns_task ON turns(task_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);

CREATE TABLE IF NOT EXISTS webhook_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
`;

declare global {
  // eslint-disable-next-line no-var
  var __cogDb: Database.Database | undefined;
}

function open(): Database.Database {
  ensureDirs();
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // A task that was mid-flight when the container stopped can never resume as
  // "running": the child process is gone with it.
  db.prepare(
    `UPDATE tasks SET status = 'failed',
                      error = COALESCE(error, 'Interrompue par un redémarrage du service'),
                      finished_at = datetime('now')
      WHERE status IN ('queued','running','pushing')`,
  ).run();
  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__cogDb) globalThis.__cogDb = open();
  return globalThis.__cogDb;
}
