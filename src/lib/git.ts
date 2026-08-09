import { spawn } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs a git command. Any installation token appearing in the output is
 * replaced before the text can reach the database or the dashboard.
 */
export function git(
  args: string[],
  cwd: string,
  options: { redact?: string[]; env?: Record<string, string> } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        ...options.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout: redact(stdout, options.redact).trim(),
        stderr: redact(stderr, options.redact).trim(),
      });
    });
  });
}

export async function gitOrThrow(
  args: string[],
  cwd: string,
  options: { redact?: string[] } = {},
): Promise<string> {
  const res = await git(args, cwd, options);
  if (res.code !== 0) {
    throw new Error(`git ${args[0]} a échoué (${res.code}) : ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

export function redact(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length > 6) out = out.split(secret).join('***');
  }
  // Catch-all for credentials embedded in any remote URL.
  return out.replace(/https:\/\/[^@\s/]+:[^@\s/]+@/g, 'https://***@');
}

/** Branch names must survive `git checkout -B` and a URL path segment. */
export function sanitizeBranch(input: string): string {
  const cleaned = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 90);
  return cleaned || 'travail';
}

export async function hasChanges(cwd: string): Promise<boolean> {
  const res = await git(['status', '--porcelain'], cwd);
  return res.stdout.length > 0;
}

export async function currentSha(cwd: string): Promise<string | null> {
  const res = await git(['rev-parse', 'HEAD'], cwd);
  return res.code === 0 ? res.stdout.trim() : null;
}
