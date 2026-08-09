import { NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth';
import { safeEqual } from '@/lib/crypto';
import { SETTING, deleteSetting, getSetting, setSecret, setSetting } from '@/lib/settings';
import { publicBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exchanges the manifest code for the App's id, slug and private key. */
export async function GET(req: Request) {
  const base = publicBaseUrl(req);
  const fail = (message: string) =>
    NextResponse.redirect(`${base}/setup?error=${encodeURIComponent(message)}`);

  if (!(await isAuthenticated())) return fail('Session expirée, reconnecte-toi et recommence');

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = getSetting('github_manifest_state');

  if (!code) return fail('GitHub n’a pas renvoyé de code');
  if (!expected || !state || !safeEqual(state, expected)) {
    return fail('Paramètre state invalide, relance la création depuis le dashboard');
  }
  deleteSetting('github_manifest_state');

  const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'claude-offgrid-cloud',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return fail(`Échange refusé par GitHub (${res.status}) ${body.slice(0, 200)}`);
  }

  const app = (await res.json()) as {
    id: number;
    slug: string;
    pem: string;
    html_url: string;
  };

  setSetting(SETTING.githubAppId, String(app.id));
  setSetting(SETTING.githubAppSlug, app.slug);
  setSecret(SETTING.githubPrivateKeyEnc, app.pem);

  // The App exists but is installed nowhere yet: send the user straight to the
  // install screen, then back to the wizard.
  return NextResponse.redirect(
    `https://github.com/apps/${app.slug}/installations/new?state=installed`,
  );
}
