import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { createTask, listTasks } from '@/lib/tasks';
import { isSetupComplete } from '@/lib/settings';
import { queueSnapshot } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  return NextResponse.json({ tasks: listTasks(), queue: queueSnapshot() });
}

export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  if (!isSetupComplete()) {
    return NextResponse.json({ error: 'Configuration incomplète' }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const task = createTask({
      repoId: String(body.repoId ?? ''),
      prompt: String(body.prompt ?? ''),
      title: body.title ? String(body.title) : undefined,
      branch: body.branch ? String(body.branch) : undefined,
      baseBranch: body.baseBranch ? String(body.baseBranch) : undefined,
      model: body.model ? String(body.model) : undefined,
      autoPush: body.autoPush !== false,
      commitMessage: body.commitMessage ? String(body.commitMessage) : undefined,
      source: 'dashboard',
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
