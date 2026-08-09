import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/crypto';
import { SETTING, setSecret, setSetting, setupState } from '@/lib/settings';
import { createSessionCookie, isAuthenticated } from '@/lib/auth';
import { listInstallations } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(setupState());
}

interface SetupBody {
  step: 'password' | 'claude' | 'github';
  password?: string;
  claudeToken?: string;
  appId?: string;
  appSlug?: string;
  privateKey?: string;
}

/**
 * The setup wizard. The password step is open only while no password exists;
 * every later step requires a session, so the endpoint cannot be used to
 * rewrite credentials once the instance is claimed.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SetupBody;
  const state = setupState();

  if (body.step === 'password') {
    if (state.hasPassword && !(await isAuthenticated())) {
      return NextResponse.json({ error: 'Mot de passe déjà défini' }, { status: 403 });
    }
    if (!body.password || body.password.length < 8) {
      return NextResponse.json(
        { error: 'Le mot de passe doit faire au moins 8 caractères' },
        { status: 400 },
      );
    }
    setSetting(SETTING.adminPasswordHash, hashPassword(body.password));
    const res = NextResponse.json({ ok: true, state: setupState() });
    const cookie = createSessionCookie();
    res.cookies.set(cookie.name, cookie.value, cookie.options);
    return res;
  }

  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
  }

  if (body.step === 'claude') {
    const token = body.claudeToken?.trim();
    if (!token) {
      return NextResponse.json({ error: "Token d'abonnement manquant" }, { status: 400 });
    }
    setSecret(SETTING.claudeTokenEnc, token);
    return NextResponse.json({ ok: true, state: setupState() });
  }

  if (body.step === 'github') {
    const appId = body.appId?.trim();
    const privateKey = body.privateKey?.trim();
    if (!appId || !/^\d+$/.test(appId)) {
      return NextResponse.json({ error: "L'App ID doit être numérique" }, { status: 400 });
    }
    if (!privateKey || !privateKey.includes('PRIVATE KEY')) {
      return NextResponse.json(
        { error: 'Colle la clé privée PEM complète (avec les lignes BEGIN/END)' },
        { status: 400 },
      );
    }
    setSetting(SETTING.githubAppId, appId);
    if (body.appSlug?.trim()) setSetting(SETTING.githubAppSlug, body.appSlug.trim());
    setSecret(SETTING.githubPrivateKeyEnc, privateKey);

    // Fail fast if the credentials are wrong rather than at the first task.
    try {
      const installations = await listInstallations();
      return NextResponse.json({
        ok: true,
        state: setupState(),
        installations,
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: `Identifiants refusés par GitHub : ${err instanceof Error ? err.message : String(err)}`,
        },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ error: 'Étape inconnue' }, { status: 400 });
}
