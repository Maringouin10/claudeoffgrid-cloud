'use client';

import { useCallback, useEffect, useState } from 'react';
import type { RepoRow } from '@/lib/db';

interface AvailableRepo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  installationId: number;
  connected: boolean;
}

export default function ReposManager({ initialRepos }: { initialRepos: RepoRow[] }) {
  const [repos, setRepos] = useState(initialRepos);
  const [available, setAvailable] = useState<AvailableRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const loadAvailable = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/repos?available=1');
    const data = (await res.json().catch(() => ({}))) as {
      repos?: AvailableRepo[];
      error?: string;
    };
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? 'Impossible de lister les dépôts');
      return;
    }
    setAvailable(data.repos ?? []);
  }, []);

  useEffect(() => {
    void loadAvailable();
  }, [loadAvailable]);

  async function connect(repo: AvailableRepo) {
    const res = await fetch('/api/repos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        owner: repo.owner,
        name: repo.name,
        installationId: repo.installationId,
        defaultBranch: repo.defaultBranch,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { repo?: RepoRow; error?: string };
    if (!res.ok || !data.repo) {
      setError(data.error ?? 'Connexion impossible');
      return;
    }
    setRepos((prev) => [...prev.filter((r) => r.id !== data.repo!.id), data.repo!]);
    setAvailable((prev) =>
      prev.map((r) => (r.fullName === repo.fullName ? { ...r, connected: true } : r)),
    );
  }

  async function disconnect(repo: RepoRow) {
    const res = await fetch(`/api/repos/${repo.id}`, { method: 'DELETE' });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? 'Suppression impossible');
      return;
    }
    setRepos((prev) => prev.filter((r) => r.id !== repo.id));
    setAvailable((prev) =>
      prev.map((r) =>
        r.fullName === `${repo.owner}/${repo.name}` ? { ...r, connected: false } : r,
      ),
    );
  }

  const shown = available.filter(
    (r) => !r.connected && r.fullName.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <>
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <h2>Connectés ({repos.length})</h2>
        {repos.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>
            Aucun dépôt connecté. Choisis-en un ci-dessous.
          </p>
        ) : (
          <table className="simple">
            <thead>
              <tr>
                <th>Dépôt</th>
                <th>Branche par défaut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {repos.map((repo) => (
                <tr key={repo.id}>
                  <td className="mono">
                    {repo.owner}/{repo.name}
                  </td>
                  <td className="mono">{repo.default_branch}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn danger small" onClick={() => disconnect(repo)}>
                      Retirer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Accessibles via la GitHub App</h2>
          <button className="btn ghost small" onClick={loadAvailable} disabled={loading}>
            {loading ? 'Chargement…' : 'Rafraîchir'}
          </button>
        </div>

        <div className="field">
          <input
            placeholder="Filtrer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loading && <p className="sub">Interrogation de GitHub…</p>}
        {!loading && shown.length === 0 && (
          <p className="sub" style={{ margin: 0 }}>
            Rien à ajouter. Installe la GitHub App sur d&apos;autres dépôts pour les voir ici.
          </p>
        )}

        <table className="simple">
          <tbody>
            {shown.map((repo) => (
              <tr key={repo.fullName}>
                <td className="mono">{repo.fullName}</td>
                <td style={{ color: 'var(--text-faint)', fontSize: 12.5 }}>
                  {repo.private ? 'privé' : 'public'} · {repo.defaultBranch}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn small" onClick={() => connect(repo)}>
                    Connecter
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
