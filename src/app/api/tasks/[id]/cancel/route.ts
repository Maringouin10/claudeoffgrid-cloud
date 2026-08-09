import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getTask, markCancelled } from '@/lib/tasks';
import { cancelTask } from '@/lib/runner';
import { emitTaskEvent } from '@/lib/bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  const task = getTask(id);
  if (!task) return NextResponse.json({ error: 'Tâche introuvable' }, { status: 404 });

  markCancelled(id);
  const killed = cancelTask(id);
  emitTaskEvent(id, 'status', { status: 'cancelled', killed });
  return NextResponse.json({ ok: true, killed });
}
