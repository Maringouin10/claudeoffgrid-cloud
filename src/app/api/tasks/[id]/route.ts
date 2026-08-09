import { NextResponse } from 'next/server';
import fs from 'node:fs';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getTask, getTurns, isActive } from '@/lib/tasks';
import { eventsSince } from '@/lib/bus';
import { workspaceFor } from '@/lib/paths';
import { branchUrl, compareUrl } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });

  return NextResponse.json({
    task,
    turns: getTurns(id),
    events: eventsSince(id, 0),
    links: {
      branch: branchUrl(task.repo_owner, task.repo_name, task.branch),
      compare: compareUrl(task.repo_owner, task.repo_name, task.base_branch, task.branch),
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });
  if (isActive(task)) {
    return NextResponse.json(
      { error: 'Annule la tâche avant de la supprimer' },
      { status: 409 },
    );
  }

  fs.rmSync(workspaceFor(id), { recursive: true, force: true });
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
