import { NextResponse } from 'next/server';
import { getDb, type RepoRow } from '@/lib/db';
import { requireSessionOrToken } from '@/lib/auth';
import { createTask } from '@/lib/tasks';
import { isSetupComplete } from '@/lib/settings';
import { branchUrl, compareUrl } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HookBody {
  /** Either `repo` as "owner/name", or an explicit repoId. */
  repo?: string;
  repoId?: string;
  prompt?: string;
  title?: string;
  branch?: string;
  baseBranch?: string;
  model?: string;
  autoPush?: boolean;
  commitMessage?: string;
}

/**
 * Trigger endpoint for n8n (or any HTTP client).
 *
 *   POST /api/hooks/run
 *   Authorization: Bearer <token créé dans Réglages ▸ Webhooks>
 *   { "repo": "owner/name", "prompt": "…" }
 *
 * Returns immediately with the task id; poll GET /api/hooks/run?taskId=… or
 * watch the dashboard for progress.
 */
export async function POST(req: Request) {
  const denied = await requireSessionOrToken(req);
  if (denied) return denied;

  if (!isSetupComplete()) {
    return NextResponse.json({ error: 'Configuration incomplète' }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as HookBody;
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: 'Le champ « prompt » est requis' }, { status: 400 });
  }

  let repoId = body.repoId;
  if (!repoId) {
    const full = body.repo?.trim();
    if (!full || !full.includes('/')) {
      return NextResponse.json(
        { error: 'Fournis « repo » au format owner/name, ou « repoId »' },
        { status: 400 },
      );
    }
    const [owner, name] = full.split('/', 2);
    const row = getDb()
      .prepare('SELECT * FROM repos WHERE owner = ? AND name = ?')
      .get(owner, name) as RepoRow | undefined;
    if (!row) {
      return NextResponse.json(
        { error: `Le dépôt ${full} n'est pas connecté dans le dashboard` },
        { status: 404 },
      );
    }
    repoId = row.id;
  }

  try {
    const task = createTask({
      repoId,
      prompt: body.prompt,
      title: body.title,
      branch: body.branch,
      baseBranch: body.baseBranch,
      model: body.model,
      autoPush: body.autoPush !== false,
      commitMessage: body.commitMessage,
      source: 'webhook',
    });
    return NextResponse.json(
      {
        taskId: task.id,
        status: task.status,
        branch: task.branch,
        dashboardUrl: `/tasks/${task.id}`,
        branchUrl: branchUrl(task.repo_owner, task.repo_name, task.branch),
        compareUrl: compareUrl(task.repo_owner, task.repo_name, task.base_branch, task.branch),
      },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

/** Polling endpoint so an n8n "Wait until done" loop can check the outcome. */
export async function GET(req: Request) {
  const denied = await requireSessionOrToken(req);
  if (denied) return denied;

  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json({ error: 'Paramètre « taskId » requis' }, { status: 400 });
  }

  const row = getDb()
    .prepare(
      `SELECT t.id, t.status, t.branch, t.base_branch, t.pushed_sha, t.error,
              t.created_at, t.finished_at, r.owner, r.name
         FROM tasks t JOIN repos r ON r.id = t.repo_id
        WHERE t.id = ?`,
    )
    .get(taskId) as
    | {
        id: string;
        status: string;
        branch: string;
        base_branch: string;
        pushed_sha: string | null;
        error: string | null;
        created_at: string;
        finished_at: string | null;
        owner: string;
        name: string;
      }
    | undefined;

  if (!row) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });

  const lastResult = getDb()
    .prepare(
      "SELECT content FROM turns WHERE task_id = ? AND role = 'assistant' ORDER BY rowid DESC LIMIT 1",
    )
    .get(taskId) as { content: string } | undefined;

  return NextResponse.json({
    taskId: row.id,
    status: row.status,
    done: ['success', 'failed', 'cancelled'].includes(row.status),
    branch: row.branch,
    baseBranch: row.base_branch,
    pushedSha: row.pushed_sha,
    error: row.error,
    summary: lastResult?.content ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    branchUrl: branchUrl(row.owner, row.name, row.branch),
    compareUrl: compareUrl(row.owner, row.name, row.base_branch, row.branch),
  });
}
