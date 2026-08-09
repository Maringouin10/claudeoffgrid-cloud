'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SettingsPayload {
  defaultModel: string;
  availableModels: string[];
  maxConcurrency: number;
  taskTimeoutMinutes: number;
  commitAuthor: { name: string; email: string };
  githubAppId: string | null;
  githubAppSlug: string | null;
  hasClaudeToken: boolean;
  hasGithubKey: boolean;
  installations: Array<{ id: number; account: string; accountType: string }>;
  githubError: string | null;
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export default function SettingsForm({ baseUrl }: { baseUrl: string }) {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState('n8n');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState({
    defaultModel: '',
    maxConcurrency: 2,
    taskTimeoutMinutes: 30,
    commitAuthorName: '',
    commitAuthorEmail: '',
    claudeToken: '',
    githubPrivateKey: '',
    githubAppId: '',
    currentPassword: '',
    newPassword: '',
  });

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([fetch('/api/settings'), fetch('/api/tokens')]);
    if (s.ok) {
      const data = (await s.json()) as SettingsPayload;
      setSettings(data);
      setForm((prev) => ({
        ...prev,
        defaultModel: data.defaultModel,
        maxConcurrency: data.maxConcurrency,
        taskTimeoutMinutes: data.taskTimeoutMinutes,
        commitAuthorName: data.commitAuthor.name,
        commitAuthorEmail: data.commitAuthor.email,
        githubAppId: data.githubAppId ?? '',
      }));
    }
    if (t.ok) setTokens(((await t.json()) as { tokens: TokenRow[] }).tokens);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setMessage(null);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; reauth?: boolean };
    if (!res.ok) {
      setMessage({ kind: 'error', text: data.error ?? 'Échec de l’enregistrement' });
      return;
    }
    if (data.reauth) {
      router.push('/login');
      return;
    }
    setMessage({ kind: 'ok', text: 'Enregistré.' });
    setForm((prev) => ({ ...prev, claudeToken: '', githubPrivateKey: '' }));
    void load();
  }

  async function createToken() {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tokenName }),
    });
    const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!res.ok || !data.token) {
      setMessage({ kind: 'error', text: data.error ?? 'Création impossible' });
      return;
    }
    setNewToken(data.token);
    void load();
  }

  async function deleteToken(id: string) {
    await fetch(`/api/tokens/${id}`, { method: 'DELETE' });
    void load();
  }

  if (!settings) return <div className="card">Chargement…</div>;

  const curlExample = `curl -X POST ${baseUrl}/api/hooks/run \\
  -H "Authorization: Bearer <TON_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "repo": "owner/name",
    "prompt": "Corrige le lint et pousse.",
    "branch": "claude/fix-lint"
  }'`;

  return (
    <>
      {message && <div className={`alert ${message.kind === 'ok' ? 'ok' : 'error'}`}>{message.text}</div>}

      <div className="card">
        <h2>Comportement de l&apos;agent</h2>
        <div className="grid-2">
          <div>
            <label htmlFor="model">Modèle par défaut</label>
            <select
              id="model"
              value={form.defaultModel}
              onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
            >
              {settings.availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="conc">Tâches simultanées</label>
            <input
              id="conc"
              type="number"
              min={1}
              max={8}
              value={form.maxConcurrency}
              onChange={(e) => setForm({ ...form, maxConcurrency: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="timeout">Délai max par tour (minutes)</label>
            <input
              id="timeout"
              type="number"
              min={1}
              max={240}
              value={form.taskTimeoutMinutes}
              onChange={(e) => setForm({ ...form, taskTimeoutMinutes: Number(e.target.value) })}
            />
          </div>
          <div>
            <label htmlFor="an">Nom des commits</label>
            <input
              id="an"
              value={form.commitAuthorName}
              onChange={(e) => setForm({ ...form, commitAuthorName: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="ae">E-mail des commits</label>
            <input
              id="ae"
              value={form.commitAuthorEmail}
              onChange={(e) => setForm({ ...form, commitAuthorEmail: e.target.value })}
            />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <button
            className="btn"
            onClick={() =>
              save({
                defaultModel: form.defaultModel,
                maxConcurrency: form.maxConcurrency,
                taskTimeoutMinutes: form.taskTimeoutMinutes,
                commitAuthorName: form.commitAuthorName,
                commitAuthorEmail: form.commitAuthorEmail,
              })
            }
          >
            Enregistrer
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Identifiants</h2>
        <p className="sub" style={{ marginTop: 0, marginBottom: 14 }}>
          Les secrets ne sont jamais réaffichés. Laisse vide pour conserver l&apos;existant.
        </p>

        <div className="field">
          <label htmlFor="ct">
            Token d&apos;abonnement Claude{' '}
            <span style={{ color: settings.hasClaudeToken ? 'var(--ok)' : 'var(--err)' }}>
              {settings.hasClaudeToken ? '· configuré' : '· manquant'}
            </span>
          </label>
          <input
            id="ct"
            type="password"
            placeholder="Nouveau token (claude setup-token)"
            value={form.claudeToken}
            onChange={(e) => setForm({ ...form, claudeToken: e.target.value })}
          />
        </div>

        <div className="grid-2">
          <div className="field">
            <label htmlFor="appid">GitHub App ID</label>
            <input
              id="appid"
              value={form.githubAppId}
              onChange={(e) => setForm({ ...form, githubAppId: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Installations détectées</label>
            <div className="code-block" style={{ minHeight: 40 }}>
              {settings.githubError
                ? settings.githubError
                : settings.installations.length === 0
                  ? 'Aucune — installe la GitHub App sur un compte.'
                  : settings.installations
                      .map((i) => `${i.account} (${i.accountType}) #${i.id}`)
                      .join('\n')}
            </div>
          </div>
        </div>

        <div className="field">
          <label htmlFor="pem">
            Clé privée GitHub App{' '}
            <span style={{ color: settings.hasGithubKey ? 'var(--ok)' : 'var(--err)' }}>
              {settings.hasGithubKey ? '· configurée' : '· manquante'}
            </span>
          </label>
          <textarea
            id="pem"
            rows={4}
            placeholder="-----BEGIN RSA PRIVATE KEY-----…"
            value={form.githubPrivateKey}
            onChange={(e) => setForm({ ...form, githubPrivateKey: e.target.value })}
          />
        </div>

        <button
          className="btn"
          onClick={() =>
            save({
              claudeToken: form.claudeToken || undefined,
              githubAppId: form.githubAppId || undefined,
              githubPrivateKey: form.githubPrivateKey || undefined,
            })
          }
        >
          Mettre à jour les identifiants
        </button>
      </div>

      <div className="card">
        <h2>Webhooks (n8n)</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Un token Bearer permet à n8n — ou n&apos;importe quel client HTTP — de lancer une tâche.
        </p>

        {newToken && (
          <div className="alert ok">
            <strong>Copie-le maintenant, il ne sera plus affiché :</strong>
            <div className="code-block" style={{ marginTop: 8 }}>
              {newToken}
            </div>
          </div>
        )}

        <div className="row" style={{ marginBottom: 16 }}>
          <input
            style={{ maxWidth: 240 }}
            value={tokenName}
            placeholder="Nom du token"
            onChange={(e) => setTokenName(e.target.value)}
          />
          <button className="btn" onClick={createToken}>
            Générer un token
          </button>
        </div>

        {tokens.length > 0 && (
          <table className="simple" style={{ marginBottom: 18 }}>
            <thead>
              <tr>
                <th>Nom</th>
                <th>Préfixe</th>
                <th>Dernier appel</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="mono">{t.prefix}…</td>
                  <td style={{ color: 'var(--text-faint)' }}>
                    {t.last_used_at
                      ? new Date(t.last_used_at + 'Z').toLocaleString('fr-FR')
                      : 'jamais'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn danger small" onClick={() => deleteToken(t.id)}>
                      Révoquer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Lancer une tâche</h3>
        <div className="code-block" style={{ marginBottom: 14 }}>
          {curlExample}
        </div>
        <h3>Suivre son avancement</h3>
        <div className="code-block">
          {`GET ${baseUrl}/api/hooks/run?taskId=<id>\nAuthorization: Bearer <TON_TOKEN>\n\n→ { "status": "success", "done": true, "branch": "…", "pushedSha": "…", "summary": "…" }`}
        </div>
      </div>

      <div className="card">
        <h2>Mot de passe</h2>
        <div className="grid-2">
          <div>
            <label htmlFor="cp">Mot de passe actuel</label>
            <input
              id="cp"
              type="password"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="np">Nouveau mot de passe</label>
            <input
              id="np"
              type="password"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
          </div>
        </div>
        <p className="hint" style={{ marginBottom: 14 }}>
          Le changer déconnecte toutes les sessions, y compris celle-ci.
        </p>
        <button
          className="btn"
          disabled={!form.currentPassword || form.newPassword.length < 8}
          onClick={() =>
            save({ currentPassword: form.currentPassword, newPassword: form.newPassword })
          }
        >
          Changer le mot de passe
        </button>
      </div>
    </>
  );
}
