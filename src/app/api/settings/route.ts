import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import {
  DEFAULT_MODEL,
  SETTING,
  commitAuthor,
  defaultModel,
  getSetting,
  hasSecret,
  maxConcurrency,
  setSecret,
  setSetting,
} from '@/lib/settings';
import { listInstallations } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;

  let installations: Array<{ id: number; account: string; accountType: string }> = [];
  let githubError: string | null = null;
  if (getSetting(SETTING.githubAppId) && hasSecret(SETTING.githubPrivateKeyEnc)) {
    try {
      installations = await listInstallations();
    } catch (err) {
      githubError = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({
    defaultModel: defaultModel(),
    availableModels: [DEFAULT_MODEL, 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    maxConcurrency: maxConcurrency(),
    taskTimeoutMinutes: Number(getSetting(SETTING.taskTimeoutMinutes)) || 30,
    commitAuthor: commitAuthor(),
    githubAppId: getSetting(SETTING.githubAppId),
    githubAppSlug: getSetting(SETTING.githubAppSlug),
    hasClaudeToken: hasSecret(SETTING.claudeTokenEnc),
    hasGithubKey: hasSecret(SETTING.githubPrivateKeyEnc),
    installations,
    githubError,
  });
}

interface SettingsBody {
  defaultModel?: string;
  maxConcurrency?: number;
  taskTimeoutMinutes?: number;
  commitAuthorName?: string;
  commitAuthorEmail?: string;
  claudeToken?: string;
  githubAppId?: string;
  githubAppSlug?: string;
  githubPrivateKey?: string;
  currentPassword?: string;
  newPassword?: string;
}

export async function PATCH(req: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as SettingsBody;

  if (body.defaultModel?.trim()) setSetting(SETTING.defaultModel, body.defaultModel.trim());
  if (body.maxConcurrency) setSetting(SETTING.maxConcurrency, String(body.maxConcurrency));
  if (body.taskTimeoutMinutes) {
    setSetting(SETTING.taskTimeoutMinutes, String(body.taskTimeoutMinutes));
  }
  if (body.commitAuthorName?.trim()) {
    setSetting(SETTING.commitAuthorName, body.commitAuthorName.trim());
  }
  if (body.commitAuthorEmail?.trim()) {
    setSetting(SETTING.commitAuthorEmail, body.commitAuthorEmail.trim());
  }
  if (body.claudeToken?.trim()) setSecret(SETTING.claudeTokenEnc, body.claudeToken.trim());
  if (body.githubAppId?.trim()) setSetting(SETTING.githubAppId, body.githubAppId.trim());
  if (body.githubAppSlug?.trim()) setSetting(SETTING.githubAppSlug, body.githubAppSlug.trim());
  if (body.githubPrivateKey?.trim()) {
    if (!body.githubPrivateKey.includes('PRIVATE KEY')) {
      return NextResponse.json({ error: 'Clé privée PEM invalide' }, { status: 400 });
    }
    setSecret(SETTING.githubPrivateKeyEnc, body.githubPrivateKey.trim());
  }

  if (body.newPassword) {
    const stored = getSetting(SETTING.adminPasswordHash);
    if (!stored || !body.currentPassword || !verifyPassword(body.currentPassword, stored)) {
      return NextResponse.json({ error: 'Mot de passe actuel incorrect' }, { status: 403 });
    }
    if (body.newPassword.length < 8) {
      return NextResponse.json(
        { error: 'Le nouveau mot de passe doit faire au moins 8 caractères' },
        { status: 400 },
      );
    }
    // Changing the password invalidates every existing session, including this
    // one — the user has to log in again.
    setSetting(SETTING.adminPasswordHash, hashPassword(body.newPassword));
    return NextResponse.json({ ok: true, reauth: true });
  }

  return NextResponse.json({ ok: true });
}
