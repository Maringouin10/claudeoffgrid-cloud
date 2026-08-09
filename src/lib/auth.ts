import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from './db';
import { hashToken, safeEqual, signSession, verifySession } from './crypto';
import { SETTING, getSetting } from './settings';

export const SESSION_COOKIE = 'cog_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SessionPayload {
  sub: 'admin';
  exp: number;
  /** Invalidates every session when the password changes. */
  pv: string;
}

function passwordVersion(): string {
  return (getSetting(SETTING.adminPasswordHash) || '').slice(-16);
}

export function createSessionCookie(): { name: string; value: string; options: object } {
  const payload: SessionPayload = {
    sub: 'admin',
    exp: Date.now() + SESSION_TTL_MS,
    pv: passwordVersion(),
  };
  return {
    name: SESSION_COOKIE,
    value: signSession(JSON.stringify(payload)),
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
      secure: process.env.COOKIE_SECURE === 'true',
    },
  };
}

export function isValidSessionValue(value: string | undefined): boolean {
  if (!value) return false;
  const payload = verifySession(value);
  if (!payload) return false;
  try {
    const parsed = JSON.parse(payload) as SessionPayload;
    if (parsed.sub !== 'admin') return false;
    if (parsed.exp < Date.now()) return false;
    return safeEqual(parsed.pv ?? '', passwordVersion());
  } catch {
    return false;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return isValidSessionValue(store.get(SESSION_COOKIE)?.value);
}

/** Returns a 401 response when the caller has no valid session, else null. */
export async function requireSession(): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;
  return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
}

/**
 * Accepts either a dashboard session cookie or an `Authorization: Bearer <token>`
 * webhook token. Used by the n8n-facing endpoints.
 */
export async function requireSessionOrToken(req: Request): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;

  const header = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const raw = match?.[1] ?? req.headers.get('x-api-key');
  if (!raw) {
    return NextResponse.json({ error: 'Token manquant' }, { status: 401 });
  }

  const row = getDb()
    .prepare('SELECT id FROM webhook_tokens WHERE token_hash = ?')
    .get(hashToken(raw.trim())) as { id: string } | undefined;
  if (!row) {
    return NextResponse.json({ error: 'Token invalide' }, { status: 401 });
  }
  getDb()
    .prepare("UPDATE webhook_tokens SET last_used_at = datetime('now') WHERE id = ?")
    .run(row.id);
  return null;
}
