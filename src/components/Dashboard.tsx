'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { RepoRow } from '@/lib/db';
import type { TaskWithRepo } from '@/lib/tasks';
import StatusBadge from './StatusBadge';

const ACTIVE = new Set(['queued', 'running', 'pushing']);

export default function Dashboard({
  initialRepos,
  initialTasks,
  defaultModel,
}: {
  initialRepos: RepoRow[];
  initialTasks: TaskWithRepo[];
  defaultModel: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [showForm, setShowForm] = useState(initialTasks.length === 0);

  // Poll while anything is in flight so the list reflects reality without a
  // manual refresh. Per-task detail uses SSE instead.
  useEffect(() => {
    const anyActive = tasks.some((t) => ACTIVE.has(t.status));
    if (!anyActive) return;
    const timer = setInterval(async () => {
      const res = await fetch('/api/tasks');
      if (!res.ok) return;
      const data = (await res.json()) as { tasks: TaskWithRepo[] };
      setTasks(data.tasks);
    }, 3000);
    return () => clearInterval(timer);
  }, [tasks]);

  if (initialRepos.length === 0) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Tâches</h1>
            <p className="sub">Aucun dépôt connecté pour l&apos;instant.</p>
          </div>
        </div>
        <div className="empty">
          <p style={{ marginTop: 0 }}>
            Connecte au moins un dépôt avant de lancer l&apos;agent.
          </p>
          <Link href="/repos" className="btn" style={{ display: 'inline-block', padding: '9px 16px' }}>
            Choisir des dépôts →
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tâches</h1>
          <p className="sub">
            {tasks.length} tâche{tasks.length > 1 ? 's' : ''} · {initialRepos.length} dépôt
            {initialRepos.length > 1 ? 's' : ''} connecté{initialRepos.length > 1 ? 's' : ''}
          </p>
        </div>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Masquer le formulaire' : '+ Nouvelle tâche'}
        </button>
      </div>

      {showForm && (
        <NewTaskForm
          repos={initialRepos}
          defaultModel={defaultModel}
          onCreated={(task) => {
            setTasks((prev) => [task, ...prev]);
            setShowForm(false);
          }}
        />
      )}

      <div style={{ marginTop: showForm ? 22 : 0 }}>
        {tasks.length === 0 ? (
          <div className="empty">Rien encore. Lance ta première tâche.</div>
        ) : (
          tasks.map((task) => (
            <div className="task-row" key={task.id}>
              <StatusBadge status={task.status} />
              <div className="task-main">
                <Link href={`/tasks/${task.id}`} className="task-title">
                  {task.title}
                </Link>
                <div className="task-meta">
                  <span>
                    {task.repo_owner}/{task.repo_name}
                  </span>
                  <span className="mono">{task.branch}</span>
                  <span>{new Date(task.created_at + 'Z').toLocaleString('fr-FR')}</span>
                  {task.source === 'webhook' && <span>via webhook</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function NewTaskForm({
  repos,
  defaultModel,
  onCreated,
}: {
  repos: RepoRow[];
  defaultModel: string;
  onCreated: (task: TaskWithRepo) => void;
}) {
  const [repoId, setRepoId] = useState(repos[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [branch, setBranch] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [model, setModel] = useState(defaultModel);
  const [autoPush, setAutoPush] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repo = repos.find((r) => r.id === repoId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repoId,
        prompt,
        title: title || undefined,
        branch: branch || undefined,
        baseBranch: baseBranch || undefined,
        model,
        autoPush,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: TaskWithRepo;
      error?: string;
    };
    setBusy(false);
    if (!res.ok || !data.task) {
      setError(data.error ?? 'Création impossible');
      return;
    }
    setPrompt('');
    setTitle('');
    setBranch('');
    onCreated(data.task);
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}

      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div>
          <label htmlFor="repo">Dépôt</label>
          <select id="repo" value={repoId} onChange={(e) => setRepoId(e.target.value)}>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>
                {r.owner}/{r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="model">Modèle</label>
          <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="claude-opus-5">Opus 5</option>
            <option value="claude-sonnet-5">Sonnet 5</option>
            <option value="claude-haiku-4-5-20251001">Haiku 4.5</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="prompt">Consigne pour l&apos;agent</label>
        <textarea
          id="prompt"
          value={prompt}
          rows={6}
          placeholder={`Ex : ajoute un endpoint /health qui renvoie la version du package,\net couvre-le par un test.`}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <p className="hint">
          L&apos;agent travaille dans un clone de{' '}
          <span className="mono">{repo ? `${repo.owner}/${repo.name}` : '…'}</span> et pousse son
          travail sur une branche dédiée.
        </p>
      </div>

      <button
        type="button"
        className="btn ghost small"
        style={{ marginBottom: advanced ? 14 : 0 }}
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? '− Options' : '+ Options'}
      </button>

      {advanced && (
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <div>
            <label htmlFor="title">Titre</label>
            <input
              id="title"
              value={title}
              placeholder="Déduit du prompt"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="branch">Branche cible</label>
            <input
              id="branch"
              value={branch}
              placeholder="claude/…"
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="base">Branche de base</label>
            <input
              id="base"
              value={baseBranch}
              placeholder={repo?.default_branch ?? 'main'}
              onChange={(e) => setBaseBranch(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 9 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: 0 }}>
              <input
                type="checkbox"
                checked={autoPush}
                onChange={(e) => setAutoPush(e.target.checked)}
              />
              Pousser automatiquement
            </label>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn" disabled={busy || !prompt.trim() || !repoId}>
          {busy ? 'Lancement…' : 'Lancer l’agent'}
        </button>
      </div>
    </form>
  );
}
