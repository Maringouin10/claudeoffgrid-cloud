import path from 'node:path';
import fs from 'node:fs';

/** Root of all mutable state. Mounted as a Docker volume in production. */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export const DB_PATH = path.join(DATA_DIR, 'app.db');
export const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
/** HOME for the spawned `claude` process, so its state survives restarts. */
export const CLAUDE_HOME = path.join(DATA_DIR, 'claude-home');

export function ensureDirs(): void {
  for (const dir of [DATA_DIR, WORKSPACES_DIR, CLAUDE_HOME]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function workspaceFor(taskId: string): string {
  return path.join(WORKSPACES_DIR, taskId);
}
