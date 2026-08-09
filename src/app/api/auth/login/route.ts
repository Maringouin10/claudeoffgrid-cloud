import { NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/crypto';
import { SETTING, getSetting } from '@/lib/settings';
import { createSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const stored = getSetting(SETTING.adminPasswordHash);

  if (!stored) {
    return NextResponse.json({ error: "L'application n'est pas encore configurée" }, { status: 409 });
  }
  if (!body.password || !verifyPassword(body.password, stored)) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  const cookie = createSessionCookie();
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
