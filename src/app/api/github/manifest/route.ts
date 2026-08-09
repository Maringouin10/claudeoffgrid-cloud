import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { randomId } from '@/lib/crypto';
import { SETTING, setSetting } from '@/lib/settings';
import { publicBaseUrl } from '@/lib/url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Builds a GitHub App manifest so the user can create the App in one click
 * instead of filling the GitHub form by hand. GitHub posts the manifest,
 * then redirects to /api/github/callback with a short-lived code we exchange
 * for the App id and private key.
 */
export async function GET(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const base = publicBaseUrl(req);
  const state = randomId(16);
  setSetting('github_manifest_state', state);

  const manifest = {
    name: `claude-offgrid-${randomId(3)}`,
    url: base,
    redirect_url: `${base}/api/github/callback`,
    public: false,
    default_permissions: {
      contents: 'write',
      metadata: 'read',
      pull_requests: 'write',
      issues: 'write',
      workflows: 'write',
    },
    default_events: [],
  };

  return NextResponse.json({
    manifest,
    state,
    // Where the browser must POST the manifest form. For an org-owned App,
    // swap in /organizations/<org>/settings/apps/new.
    action: `https://github.com/settings/apps/new?state=${state}`,
    orgActionTemplate: `https://github.com/organizations/{org}/settings/apps/new?state=${state}`,
    baseUrl: base,
  });
}
