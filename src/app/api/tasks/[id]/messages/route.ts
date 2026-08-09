import { NextResponse } from 'next/server';
import { requireSessionOrToken } from '@/lib/auth';
import { addFollowUp } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Follow-up message: resumes the task's Claude session with its context. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSessionOrToken(req);
  if (denied) return denied;

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { prompt?: string };
  try {
    const task = addFollowUp(id, String(body.prompt ?? ''));
    return NextResponse.json({ task }, { status: 202 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
