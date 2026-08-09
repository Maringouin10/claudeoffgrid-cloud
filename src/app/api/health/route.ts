import { NextResponse } from 'next/server';
import { isSetupComplete } from '@/lib/settings';
import { queueSnapshot } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Unauthenticated liveness probe — exposes no configuration detail. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    configured: isSetupComplete(),
    queue: queueSnapshot(),
  });
}
