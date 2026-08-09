import { NextResponse } from 'next/server';
import { getDb, type WebhookTokenRow } from '@/lib/db';
import { hashToken, randomId, randomToken } from '@/lib/crypto';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  const tokens = getDb()
    .prepare('SELECT id, name, prefix, created_at, last_used_at FROM webhook_tokens ORDER BY created_at DESC')
    .all() as Array<Omit<WebhookTokenRow, 'token_hash'>>;
  return NextResponse.json({ tokens });
}

/** The plaintext token is shown once here and never stored. */
export async function POST(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim() || 'n8n';
  const token = randomToken();

  getDb()
    .prepare('INSERT INTO webhook_tokens (id, name, token_hash, prefix) VALUES (?, ?, ?, ?)')
    .run(`whk_${randomId(6)}`, name, hashToken(token), token.slice(0, 12));

  return NextResponse.json({ token, name }, { status: 201 });
}
