import crypto from 'node:crypto';
import { SETTING, getSecret, getSetting } from './settings';

const API = 'https://api.github.com';

export interface InstallationSummary {
  id: number;
  account: string;
  accountType: string;
}

export interface RemoteRepo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  installationId: number;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function appCredentials(): { appId: string; privateKey: string } {
  const appId = getSetting(SETTING.githubAppId);
  const privateKey = getSecret(SETTING.githubPrivateKeyEnc);
  if (!appId || !privateKey) {
    throw new GitHubError("La GitHub App n'est pas configurée", 400);
  }
  return { appId, privateKey };
}

/** Short-lived RS256 JWT identifying the App itself (not an installation). */
function appJwt(): string {
  const { appId, privateKey } = appCredentials();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  ).toString('base64url');
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

async function ghFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'claude-offgrid-cloud',
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubError(
      `GitHub ${res.status} sur ${path}${body ? ` — ${body.slice(0, 300)}` : ''}`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function listInstallations(): Promise<InstallationSummary[]> {
  const raw = await ghFetch<
    Array<{ id: number; account: { login: string; type: string } | null }>
  >('/app/installations?per_page=100', appJwt());
  return raw.map((i) => ({
    id: i.id,
    account: i.account?.login ?? 'inconnu',
    accountType: i.account?.type ?? 'User',
  }));
}

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}
declare global {
  // eslint-disable-next-line no-var
  var __cogGhTokens: Map<number, TokenCacheEntry> | undefined;
}
function tokenCache(): Map<number, TokenCacheEntry> {
  if (!globalThis.__cogGhTokens) globalThis.__cogGhTokens = new Map();
  return globalThis.__cogGhTokens;
}

/** Installation access token, cached until one minute before it expires. */
export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache().get(installationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await ghFetch<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    appJwt(),
    { method: 'POST' },
  );
  tokenCache().set(installationId, {
    token: res.token,
    expiresAt: new Date(res.expires_at).getTime(),
  });
  return res.token;
}

export async function listInstallationRepos(installationId: number): Promise<RemoteRepo[]> {
  const token = await installationToken(installationId);
  const out: RemoteRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await ghFetch<{
      repositories: Array<{
        name: string;
        full_name: string;
        default_branch: string;
        private: boolean;
        owner: { login: string };
      }>;
    }>(`/installation/repositories?per_page=100&page=${page}`, token);
    for (const r of res.repositories) {
      out.push({
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        defaultBranch: r.default_branch || 'main',
        private: r.private,
        installationId,
      });
    }
    if (res.repositories.length < 100) break;
  }
  return out;
}

export async function listAllAccessibleRepos(): Promise<RemoteRepo[]> {
  const installations = await listInstallations();
  const results = await Promise.all(
    installations.map((i) => listInstallationRepos(i.id).catch(() => [])),
  );
  return results.flat().sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getRepo(
  installationId: number,
  owner: string,
  name: string,
): Promise<{ defaultBranch: string }> {
  const token = await installationToken(installationId);
  const res = await ghFetch<{ default_branch: string }>(`/repos/${owner}/${name}`, token);
  return { defaultBranch: res.default_branch || 'main' };
}

/** Authenticated clone URL. Never log this — it embeds a live token. */
export async function authenticatedCloneUrl(
  installationId: number,
  owner: string,
  name: string,
): Promise<string> {
  const token = await installationToken(installationId);
  return `https://x-access-token:${token}@github.com/${owner}/${name}.git`;
}

export function branchUrl(owner: string, name: string, branch: string): string {
  return `https://github.com/${owner}/${name}/tree/${encodeURIComponent(branch)}`;
}

export function compareUrl(owner: string, name: string, base: string, branch: string): string {
  return `https://github.com/${owner}/${name}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`;
}
