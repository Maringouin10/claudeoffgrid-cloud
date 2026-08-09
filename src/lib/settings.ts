import { getDb } from './db';
import { decryptSecret, encryptSecret } from './crypto';

/** Keys holding plaintext configuration. */
export const SETTING = {
  adminPasswordHash: 'admin_password_hash',
  claudeTokenEnc: 'claude_oauth_token_enc',
  githubAppId: 'github_app_id',
  githubAppSlug: 'github_app_slug',
  githubPrivateKeyEnc: 'github_private_key_enc',
  defaultModel: 'default_model',
  maxConcurrency: 'max_concurrency',
  taskTimeoutMinutes: 'task_timeout_minutes',
  commitAuthorName: 'commit_author_name',
  commitAuthorEmail: 'commit_author_email',
  setupCompleted: 'setup_completed',
} as const;

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export function setSecret(key: string, plain: string): void {
  setSetting(key, encryptSecret(plain));
}

export function getSecret(key: string): string | null {
  const raw = getSetting(key);
  if (!raw) return null;
  try {
    return decryptSecret(raw);
  } catch {
    // Wrong APP_SECRET, or the data volume was restored without master.key.
    return null;
  }
}

export function hasSecret(key: string): boolean {
  return getSetting(key) !== null;
}

export const DEFAULT_MODEL = 'claude-opus-5';

export function defaultModel(): string {
  return getSetting(SETTING.defaultModel) || DEFAULT_MODEL;
}

export function maxConcurrency(): number {
  const raw = Number(getSetting(SETTING.maxConcurrency));
  return Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 8) : 2;
}

export function taskTimeoutMs(): number {
  const raw = Number(getSetting(SETTING.taskTimeoutMinutes));
  const minutes = Number.isFinite(raw) && raw >= 1 ? Math.min(raw, 240) : 30;
  return minutes * 60_000;
}

export function commitAuthor(): { name: string; email: string } {
  return {
    name: getSetting(SETTING.commitAuthorName) || 'Claude Offgrid',
    email: getSetting(SETTING.commitAuthorEmail) || 'claude-offgrid@users.noreply.github.com',
  };
}

/** The dashboard is unusable until a password and the two credentials exist. */
export function setupState() {
  return {
    hasPassword: !!getSetting(SETTING.adminPasswordHash),
    hasClaudeToken: hasSecret(SETTING.claudeTokenEnc),
    hasGithubApp: !!getSetting(SETTING.githubAppId) && hasSecret(SETTING.githubPrivateKeyEnc),
  };
}

export function isSetupComplete(): boolean {
  const s = setupState();
  return s.hasPassword && s.hasClaudeToken && s.hasGithubApp;
}
