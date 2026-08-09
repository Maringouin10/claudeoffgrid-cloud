import { getDb, type RepoRow, type TaskRow, type TurnRow } from './db';
import { randomId } from './crypto';
import { sanitizeBranch } from './git';
import { defaultModel } from './settings';
import { enqueue } from './queue';
import { isRunning } from './runner';

export interface CreateTaskInput {
  repoId: string;
  prompt: string;
  title?: string;
  branch?: string;
  baseBranch?: string;
  model?: string;
  autoPush?: boolean;
  commitMessage?: string;
  source?: string;
}

export interface TaskWithRepo extends TaskRow {
  repo_owner: string;
  repo_name: string;
}

export function listTasks(limit = 100): TaskWithRepo[] {
  return getDb()
    .prepare(
      `SELECT t.*, r.owner AS repo_owner, r.name AS repo_name
         FROM tasks t JOIN repos r ON r.id = t.repo_id
        ORDER BY t.created_at DESC LIMIT ?`,
    )
    .all(limit) as TaskWithRepo[];
}

export function getTask(id: string): TaskWithRepo | null {
  return (
    (getDb()
      .prepare(
        `SELECT t.*, r.owner AS repo_owner, r.name AS repo_name
           FROM tasks t JOIN repos r ON r.id = t.repo_id
          WHERE t.id = ?`,
      )
      .get(id) as TaskWithRepo | undefined) ?? null
  );
}

export function getTurns(taskId: string): TurnRow[] {
  return getDb()
    .prepare('SELECT * FROM turns WHERE task_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(taskId) as TurnRow[];
}

function deriveTitle(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0] ?? 'Tâche';
  return firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine || 'Tâche';
}

export function createTask(input: CreateTaskInput): TaskWithRepo {
  const db = getDb();
  const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(input.repoId) as
    | RepoRow
    | undefined;
  if (!repo) throw new Error('Dépôt inconnu');

  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Le prompt est vide');

  const id = `task_${randomId(8)}`;
  const title = (input.title?.trim() || deriveTitle(prompt)).slice(0, 120);
  const branch = input.branch?.trim()
    ? sanitizeBranch(input.branch)
    : `claude/${sanitizeBranch(title)}-${id.slice(-6)}`;
  const baseBranch = input.baseBranch?.trim() || repo.default_branch;

  db.prepare(
    `INSERT INTO tasks (id, repo_id, title, branch, base_branch, status, model, auto_push, commit_message, source)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
  ).run(
    id,
    repo.id,
    title,
    branch,
    baseBranch,
    input.model?.trim() || defaultModel(),
    input.autoPush === false ? 0 : 1,
    input.commitMessage?.trim() || null,
    input.source || 'dashboard',
  );

  db.prepare('INSERT INTO turns (id, task_id, role, content) VALUES (?, ?, ?, ?)').run(
    `turn_${randomId(6)}`,
    id,
    'user',
    prompt,
  );

  enqueue(id, prompt);
  return getTask(id)!;
}

/** Sends a follow-up message into an existing task, resuming its session. */
export function addFollowUp(taskId: string, prompt: string): TaskWithRepo {
  const task = getTask(taskId);
  if (!task) throw new Error('Tâche introuvable');
  if (task.status === 'queued' || task.status === 'running' || task.status === 'pushing') {
    throw new Error('La tâche est déjà en cours');
  }
  const text = prompt.trim();
  if (!text) throw new Error('Le message est vide');

  getDb()
    .prepare('INSERT INTO turns (id, task_id, role, content) VALUES (?, ?, ?, ?)')
    .run(`turn_${randomId(6)}`, taskId, 'user', text);

  enqueue(taskId, text);
  return getTask(taskId)!;
}

export function markCancelled(taskId: string): void {
  getDb()
    .prepare(
      `UPDATE tasks SET status = 'cancelled', finished_at = datetime('now'),
                        error = COALESCE(error, 'Annulée depuis le dashboard')
        WHERE id = ?`,
    )
    .run(taskId);
}

export function isActive(task: TaskRow): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'running' ||
    task.status === 'pushing' ||
    isRunning(task.id)
  );
}
