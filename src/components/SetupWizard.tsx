'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SetupState {
  hasPassword: boolean;
  hasClaudeToken: boolean;
  hasGithubApp: boolean;
}

const STEPS = ['Mot de passe', 'Token Claude', 'GitHub App'] as const;

export default function SetupWizard({
  initialState,
  initialError,
}: {
  initialState: SetupState;
  initialError: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  const [password, setPassword] = useState('');
  const [claudeToken, setClaudeToken] = useState('');
  const [manualGithub, setManualGithub] = useState(false);
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  const current = !state.hasPassword ? 0 : !state.hasClaudeToken ? 1 : 2;

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      state?: SetupState;
    };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? 'Erreur inattendue');
      return false;
    }
    if (data.state) setState(data.state);
    return true;
  }

  /** Sends the browser to GitHub with the manifest as a POSTed form field. */
  async function createGithubApp(org: string | null) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/github/manifest');
    const data = (await res.json().catch(() => ({}))) as {
      manifest?: unknown;
      action?: string;
      orgActionTemplate?: string;
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !data.manifest || !data.action) {
      setError(data.error ?? 'Impossible de préparer le manifest GitHub');
      return;
    }

    const action =
      org && data.orgActionTemplate
        ? data.orgActionTemplate.replace('{org}', encodeURIComponent(org))
        : data.action;

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'manifest';
    input.value = JSON.stringify(data.manifest);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <>
      <div className="wizard-steps">
        {STEPS.map((label, i) => (
          <div
            key={label}
            className={`wizard-step ${i === current ? 'active' : ''} ${i < current ? 'done' : ''}`}
          >
            {i < current ? '✓ ' : ''}
            {label}
          </div>
        ))}
      </div>

      <div className="card">
        {error && <div className="alert error">{error}</div>}

        {current === 0 && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post({ step: 'password', password })) router.refresh();
            }}
          >
            <h2>Protège le dashboard</h2>
            <p className="sub" style={{ marginBottom: 16 }}>
              Ce mot de passe est le seul accès à l&apos;instance. Il est stocké haché (scrypt).
            </p>
            <div className="field">
              <label htmlFor="pw">Mot de passe administrateur</label>
              <input
                id="pw"
                type="password"
                value={password}
                autoFocus
                minLength={8}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="hint">8 caractères minimum.</p>
            </div>
            <button className="btn" disabled={busy || password.length < 8}>
              {busy ? 'Enregistrement…' : 'Continuer'}
            </button>
          </form>
        )}

        {current === 1 && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post({ step: 'claude', claudeToken })) router.refresh();
            }}
          >
            <h2>Token d&apos;abonnement Claude</h2>
            <p className="sub" style={{ marginBottom: 14 }}>
              Sur une machine où Claude Code est installé et connecté, lance :
            </p>
            <div className="code-block" style={{ marginBottom: 14 }}>
              claude setup-token
            </div>
            <p className="sub" style={{ marginBottom: 14 }}>
              Colle le token obtenu ci-dessous. Il est chiffré (AES-256-GCM) avant d&apos;être
              stocké, et n&apos;est jamais réaffiché.
            </p>
            <div className="field">
              <label htmlFor="ct">Token</label>
              <input
                id="ct"
                type="password"
                value={claudeToken}
                autoFocus
                placeholder="sk-ant-oat…"
                onChange={(e) => setClaudeToken(e.target.value)}
              />
            </div>
            <button className="btn" disabled={busy || !claudeToken.trim()}>
              {busy ? 'Enregistrement…' : 'Continuer'}
            </button>
          </form>
        )}

        {current === 2 && !manualGithub && (
          <div>
            <h2>Connecte GitHub</h2>
            <p className="sub" style={{ marginBottom: 16 }}>
              Je génère une GitHub App pré-configurée (droits <code>contents</code>,{' '}
              <code>pull_requests</code>, <code>issues</code>, <code>workflows</code>). GitHub te
              demandera de valider, puis de choisir les dépôts auxquels l&apos;agent aura accès.
            </p>
            <div className="row" style={{ marginBottom: 14 }}>
              <button className="btn" disabled={busy} onClick={() => createGithubApp(null)}>
                {busy ? 'Préparation…' : 'Créer la GitHub App'}
              </button>
              <button className="btn ghost" onClick={() => setManualGithub(true)}>
                J&apos;ai déjà une App
              </button>
            </div>
            <p className="hint">
              Pour une App appartenant à une organisation, utilise « J&apos;ai déjà une App » après
              l&apos;avoir créée côté GitHub, ou définis <code>PUBLIC_URL</code> puis relance.
            </p>
          </div>
        )}

        {current === 2 && manualGithub && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post({ step: 'github', appId, privateKey })) router.push('/');
            }}
          >
            <h2>GitHub App existante</h2>
            <div className="field">
              <label htmlFor="appid">App ID</label>
              <input
                id="appid"
                value={appId}
                inputMode="numeric"
                placeholder="123456"
                onChange={(e) => setAppId(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pem">Clé privée (PEM)</label>
              <textarea
                id="pem"
                value={privateKey}
                rows={7}
                placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;…"
                onChange={(e) => setPrivateKey(e.target.value)}
              />
              <p className="hint">
                Réglages de l&apos;App ▸ « Generate a private key ». Chiffrée avant stockage.
              </p>
            </div>
            <div className="row">
              <button className="btn" disabled={busy || !appId || !privateKey}>
                {busy ? 'Vérification…' : 'Vérifier et terminer'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setManualGithub(false)}>
                Retour
              </button>
            </div>
          </form>
        )}
      </div>

      {state.hasGithubApp && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button className="btn ghost" onClick={() => router.push('/repos')}>
            Configuration terminée — choisir les dépôts
          </button>
        </div>
      )}
    </>
  );
}
