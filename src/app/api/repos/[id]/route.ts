import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  const count = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tasks WHERE repo_id = ?')
    .get(id) as { n: number };
  if (count.n > 0) {
    return NextResponse.json(
      { error: `Ce dépôt a ${count.n} tâche(s) ; supprime-les d'abord.` },
      { status: 409 },
    );
  }

  getDb().prepare('DELETE FROM repos WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
