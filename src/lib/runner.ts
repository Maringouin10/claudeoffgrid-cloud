import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { getDb, type RepoRow, type TaskRow } from './db';
import { emitTaskEvent } from './bus';
import { CLAUDE_HOME, ensureDirs, workspaceFor } from './paths';
import { git, gitOrThrow, hasChanges, redact } from './git';
import { authenticatedCloneUrl, installationToken } from './github';
import {
  SETTING,
  commitAuthor,
  defaultModel,
  getSecret,
  taskTimeoutMs,
} from './settings';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';

declare global {
  // eslint-disable-next-line no-var
  var __cogRunning: Map<string, ChildProcess> | undefined;
}
function running(): Map<string, ChildProcess> {
  if (!globalThis.__cogRunning) globalThis.__cogRunning = new Map();
  return globalThis.__cogRunning;
}

export function isRunning(taskId: string): boolean {
  return running().has(taskId);
}

export function cancelTask(taskId: string): boolean {
  const child = running().get(taskId);
  if (!child) return false;
  child.kill('SIGTERM');
  setTimeout(() => {
    if (running().has(taskId)) child.kill('SIGKILL');
  }, 5_000);
  return true;
}

function setStatus(taskId: string, status: TaskRow['status'], extra: Partial<TaskRow> = {}): void {
  const db = getDb();
  const fields: string[] = ['status = ?'];
  const values: unknown[] = [status];
  for (const [key, value] of Object.entries(extra)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  if (status === 'running' && !extra.started_at) {
    fields.push("started_at = COALESCE(started_at, datetime('now'))");
  }
  if (status === 'success' || status === 'failed' || status === 'cancelled') {
    fields.push("finished_at = datetime('now')");
  }
  values.push(taskId);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  emitTaskEvent(taskId, 'status', { status, ...extra });
}

function log(taskId: string, level: 'info' | 'warn' | 'error', message: string): void {
  emitTaskEvent(taskId, 'log', { level, message });
}

/**
 * Prepares the task workspace: a fresh clone of the base branch with the
 * working branch checked out (reusing the remote branch when it already
 * exists, so a resumed task keeps building on its own history).
 */
async function prepareWorkspace(task: TaskRow, repo: RepoRow, token: string): Promise<string> {
  ensureDirs();
  const dir = workspaceFor(task.id);
  const redactList = [token];

  if (fs.existsSync(`${dir}/.git`)) {
    log(task.id, 'info', `Réutilisation du dossier de travail existant`);
    const url = await authenticatedCloneUrl(repo.installation_id, repo.owner, repo.name);
    await gitOrThrow(['remote', 'set-url', 'origin', url], dir, { redact: redactList });
    await gitOrThrow(['fetch', 'origin', '--prune'], dir, { redact: redactList });
    return dir;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const url = await authenticatedCloneUrl(repo.installation_id, repo.owner, repo.name);
  log(task.id, 'info', `Clonage de ${repo.owner}/${repo.name} (base : ${task.base_branch})`);
  await gitOrThrow(
    ['clone', '--no-single-branch', '--branch', task.base_branch, url, '.'],
    dir,
    { redact: redactList },
  );

  const author = commitAuthor();
  await gitOrThrow(['config', 'user.name', author.name], dir);
  await gitOrThrow(['config', 'user.email', author.email], dir);

  // Continue an existing remote branch when there is one, otherwise fork it
  // off the base branch.
  const remoteBranch = await git(
    ['ls-remote', '--heads', 'origin', task.branch],
    dir,
    { redact: redactList },
  );
  if (remoteBranch.code === 0 && remoteBranch.stdout.trim().length > 0) {
    log(task.id, 'info', `La branche ${task.branch} existe déjà, reprise à partir de son état`);
    await gitOrThrow(['checkout', '-B', task.branch, `origin/${task.branch}`], dir, {
      redact: redactList,
    });
  } else {
    await gitOrThrow(['checkout', '-B', task.branch], dir, { redact: redactList });
  }

  return dir;
}

interface ClaudeOutcome {
  sessionId: string | null;
  resultText: string | null;
  exitCode: number;
  isError: boolean;
}

/**
 * Runs the Claude Code CLI headless and streams its NDJSON output into the
 * event bus. Resolves once the process exits.
 */
function runClaude(
  task: TaskRow,
  prompt: string,
  cwd: string,
  resumeSessionId: string | null,
): Promise<ClaudeOutcome> {
  const claudeToken = getSecret(SETTING.claudeTokenEnc);
  if (!claudeToken) {
    return Promise.reject(new Error("Aucun token d'abonnement Claude configuré"));
  }

  // Claude Code refuses --dangerously-skip-permissions under uid 0. Say so
  // plainly here, because the CLI's own message reads like a config problem.
  if (process.getuid?.() === 0) {
    return Promise.reject(
      new Error(
        'Le service tourne en root, or Claude Code refuse ' +
          '--dangerously-skip-permissions sous root. Avec Docker, reconstruis ' +
          "l'image : elle bascule sur l'utilisateur non privilégié « node ». " +
          'En local, lance le serveur depuis un compte non-root.',
      ),
    );
  }

  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    task.model || defaultModel(),
    // The workspace is a throwaway clone inside an isolated container, so the
    // agent is allowed to edit and run commands without prompting.
    '--dangerously-skip-permissions',
  ];
  if (resumeSessionId) args.push('--resume', resumeSessionId);

  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, args, {
      cwd,
      env: {
        ...process.env,
        HOME: CLAUDE_HOME,
        CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
        // Never let an API key silently take precedence over the subscription
        // token the user configured.
        ANTHROPIC_API_KEY: '',
        CI: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    running().set(task.id, child);

    const outcome: ClaudeOutcome = {
      sessionId: resumeSessionId,
      resultText: null,
      exitCode: -1,
      isError: false,
    };

    const timeout = setTimeout(() => {
      log(task.id, 'error', `Délai maximum atteint, arrêt de l'agent`);
      child.kill('SIGTERM');
    }, taskTimeoutMs());

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        emitTaskEvent(task.id, 'log', { level: 'info', message: redact(trimmed, [claudeToken]) });
        return;
      }
      handleClaudeMessage(task.id, parsed, outcome);
    });

    let stderrBuffer = '';
    child.stderr.on('data', (chunk) => {
      const text = redact(chunk.toString(), [claudeToken]);
      stderrBuffer += text;
      log(task.id, 'warn', text.trim());
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      running().delete(task.id);
      reject(new Error(`Impossible de lancer « ${CLAUDE_BIN} » : ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      running().delete(task.id);
      rl.close();
      outcome.exitCode = code ?? -1;
      if (code !== 0 && !outcome.resultText) {
        outcome.isError = true;
        outcome.resultText = stderrBuffer.trim() || `Le CLI claude s'est arrêté avec le code ${code}`;
      }
      resolve(outcome);
    });
  });
}

/** Translates one stream-json message into a dashboard event. */
function handleClaudeMessage(
  taskId: string,
  msg: Record<string, unknown>,
  outcome: ClaudeOutcome,
): void {
  const type = String(msg.type ?? '');

  if (type === 'system' && msg.subtype === 'init') {
    if (typeof msg.session_id === 'string') outcome.sessionId = msg.session_id;
    emitTaskEvent(taskId, 'init', {
      sessionId: msg.session_id,
      model: msg.model,
      tools: Array.isArray(msg.tools) ? (msg.tools as string[]).length : undefined,
      cwd: msg.cwd,
    });
    return;
  }

  if (type === 'assistant' || type === 'user') {
    const message = msg.message as { content?: unknown } | undefined;
    const content = Array.isArray(message?.content) ? message?.content : [];
    for (const block of content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        emitTaskEvent(taskId, 'assistant_text', { text: block.text });
      } else if (block.type === 'thinking') {
        emitTaskEvent(taskId, 'thinking', { text: String(block.thinking ?? '') });
      } else if (block.type === 'tool_use') {
        emitTaskEvent(taskId, 'tool_use', {
          name: block.name,
          input: summarizeToolInput(block.input),
        });
      } else if (block.type === 'tool_result') {
        emitTaskEvent(taskId, 'tool_result', {
          isError: block.is_error === true,
          text: truncate(stringifyResult(block.content), 4000),
        });
      }
    }
    return;
  }

  if (type === 'result') {
    outcome.isError = msg.is_error === true || msg.subtype !== 'success';
    if (typeof msg.result === 'string') outcome.resultText = msg.result;
    if (typeof msg.session_id === 'string') outcome.sessionId = msg.session_id;
    emitTaskEvent(taskId, 'result', {
      subtype: msg.subtype,
      isError: outcome.isError,
      durationMs: msg.duration_ms,
      numTurns: msg.num_turns,
      totalCostUsd: msg.total_cost_usd,
      usage: msg.usage,
    });
  }
}

function summarizeToolInput(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = truncate(typeof value === 'string' ? value : JSON.stringify(value), 800);
  }
  return out;
}

function stringifyResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && 'text' in (c as Record<string, unknown>)
          ? String((c as Record<string, unknown>).text)
          : JSON.stringify(c),
      )
      .join('\n');
  }
  return JSON.stringify(content ?? '');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (${text.length - max} caractères tronqués)` : text;
}

async function commitAndPush(task: TaskRow, repo: RepoRow, dir: string, token: string): Promise<void> {
  const redactList = [token];

  if (!(await hasChanges(dir))) {
    log(task.id, 'info', "Aucune modification à committer : l'agent n'a pas touché aux fichiers");
    // The branch may still hold commits the agent made itself.
    const ahead = await git(
      ['rev-list', '--count', `origin/${task.base_branch}..HEAD`],
      dir,
      { redact: redactList },
    );
    if (ahead.code !== 0 || Number(ahead.stdout.trim() || '0') === 0) return;
  } else {
    await gitOrThrow(['add', '-A'], dir, { redact: redactList });
    const message =
      task.commit_message?.trim() || `${task.title}\n\nGénéré par Claude Offgrid Cloud.`;
    const commit = await git(['commit', '-m', message], dir, { redact: redactList });
    if (commit.code !== 0 && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      throw new Error(`Échec du commit : ${commit.stderr || commit.stdout}`);
    }
    log(task.id, 'info', 'Modifications committées');
  }

  setStatus(task.id, 'pushing');
  const url = await authenticatedCloneUrl(repo.installation_id, repo.owner, repo.name);
  await gitOrThrow(['remote', 'set-url', 'origin', url], dir, { redact: redactList });

  const push = await git(['push', '-u', 'origin', `HEAD:refs/heads/${task.branch}`], dir, {
    redact: redactList,
  });
  if (push.code !== 0) {
    throw new Error(`Échec du push : ${push.stderr || push.stdout}`);
  }

  const sha = (await git(['rev-parse', 'HEAD'], dir)).stdout.trim();
  getDb().prepare('UPDATE tasks SET pushed_sha = ? WHERE id = ?').run(sha, task.id);
  log(task.id, 'info', `Poussé sur ${task.branch} (${sha.slice(0, 7)})`);
  emitTaskEvent(task.id, 'pushed', { branch: task.branch, sha });
}

/** Executes one turn of a task: prepare, run the agent, push. */
export async function executeTask(taskId: string, prompt: string): Promise<void> {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw new Error('Tâche introuvable');
  const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(task.repo_id) as
    | RepoRow
    | undefined;
  if (!repo) throw new Error('Dépôt introuvable');

  let token = '';
  try {
    setStatus(taskId, 'running', { error: null });
    token = await installationToken(repo.installation_id);
    const dir = await prepareWorkspace(task, repo, token);

    const outcome = await runClaude(task, prompt, dir, task.session_id);
    if (outcome.sessionId && outcome.sessionId !== task.session_id) {
      db.prepare('UPDATE tasks SET session_id = ? WHERE id = ?').run(outcome.sessionId, taskId);
    }
    if (outcome.resultText) {
      db.prepare('INSERT INTO turns (id, task_id, role, content) VALUES (?, ?, ?, ?)').run(
        `turn_${Date.now().toString(36)}`,
        taskId,
        'assistant',
        outcome.resultText,
      );
    }

    const cancelled = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId) as {
      status: TaskRow['status'];
    };
    if (cancelled.status === 'cancelled') {
      log(taskId, 'warn', 'Tâche annulée');
      return;
    }

    if (outcome.isError) {
      setStatus(taskId, 'failed', { error: outcome.resultText || 'Échec de l’agent' });
      return;
    }

    if (task.auto_push) {
      await commitAndPush(task, repo, dir, token);
    } else {
      log(taskId, 'info', 'Push automatique désactivé pour cette tâche');
    }
    setStatus(taskId, 'success', { error: null });
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err), [token]);
    log(taskId, 'error', message);
    setStatus(taskId, 'failed', { error: message });
  }
}
