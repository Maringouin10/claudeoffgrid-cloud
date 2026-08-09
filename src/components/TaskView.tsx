'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { TurnRow } from '@/lib/db';
import type { TaskWithRepo } from '@/lib/tasks';
import type { TaskEvent } from '@/lib/bus';
import StatusBadge from './StatusBadge';

const ACTIVE = new Set(['queued', 'running', 'pushing']);

export default function TaskView({
  initialTask,
  initialTurns,
  initialEvents,
  links,
}: {
  initialTask: TaskWithRepo;
  initialTurns: TurnRow[];
  initialEvents: TaskEvent[];
  links: { branch: string; compare: string };
}) {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [turns, setTurns] = useState(initialTurns);
  const [events, setEvents] = useState(initialEvents);
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const streamRef = useRef<HTMLDivElement>(null);
  const lastEventId = useRef(initialEvents.at(-1)?.id ?? 0);

  const refreshTask = useCallback(async () => {
    const res = await fetch(`/api/tasks/${initialTask.id}`);
    if (!res.ok) return;
    const data = (await res.json()) as { task: TaskWithRepo; turns: TurnRow[] };
    setTask(data.task);
    setTurns(data.turns);
  }, [initialTask.id]);

  // One SSE connection per open task page; `after` replays anything missed
  // across a reconnect.
  useEffect(() => {
    const source = new EventSource(
      `/api/tasks/${initialTask.id}/stream?after=${lastEventId.current}`,
    );

    const onEvent = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as TaskEvent;
        if (event.id <= lastEventId.current) return;
        lastEventId.current = event.id;
        setEvents((prev) => [...prev, event]);
        if (event.kind === 'status' || event.kind === 'pushed' || event.kind === 'result') {
          void refreshTask();
        }
      } catch {
        /* ignore malformed frame */
      }
    };

    for (const kind of [
      'queued',
      'status',
      'init',
      'log',
      'assistant_text',
      'thinking',
      'tool_use',
      'tool_result',
      'result',
      'pushed',
    ]) {
      source.addEventListener(kind, onEvent);
    }
    source.onerror = () => {
      /* EventSource reconnects on its own */
    };

    return () => source.close();
  }, [initialTask.id, refreshTask]);

  useEffect(() => {
    if (autoScroll && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const active = ACTIVE.has(task.status);

  async function sendFollowUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tasks/${task.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: followUp }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? 'Envoi impossible');
      return;
    }
    setFollowUp('');
    void refreshTask();
  }

  async function cancel() {
    await fetch(`/api/tasks/${task.id}/cancel`, { method: 'POST' });
    void refreshTask();
  }

  async function remove() {
    if (!confirm('Supprimer cette tâche et son dossier de travail ?')) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/');
  }

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <StatusBadge status={task.status} />
            <span className="mono" style={{ color: 'var(--text-faint)' }}>
              {task.repo_owner}/{task.repo_name}
            </span>
          </div>
          <h1>{task.title}</h1>
          <p className="sub">
            <span className="mono">{task.base_branch}</span> →{' '}
            <a href={links.branch} target="_blank" rel="noreferrer" className="mono">
              {task.branch}
            </a>
            {task.pushed_sha && (
              <>
                {' · '}
                <span className="mono">{task.pushed_sha.slice(0, 7)}</span>
                {' · '}
                <a href={links.compare} target="_blank" rel="noreferrer">
                  ouvrir une PR
                </a>
              </>
            )}
          </p>
        </div>
        <div className="row">
          {active ? (
            <button className="btn danger" onClick={cancel}>
              Annuler
            </button>
          ) : (
            <button className="btn danger" onClick={remove}>
              Supprimer
            </button>
          )}
          <Link href="/" className="btn ghost" style={{ padding: '9px 16px' }}>
            Retour
          </Link>
        </div>
      </div>

      {task.error && <div className="alert error">{task.error}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Flux de l&apos;agent</h2>
          <label style={{ margin: 0, display: 'flex', gap: 7, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Défilement auto
          </label>
        </div>
        <div className="stream" ref={streamRef}>
          {events.length === 0 && (
            <div style={{ color: 'var(--text-faint)' }}>En attente du démarrage…</div>
          )}
          {events.map((event) => (
            <EventLine key={event.id} event={event} />
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Conversation</h2>
        {turns.map((turn) => (
          <div key={turn.id} className={`turn ${turn.role}`}>
            <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {turn.role === 'user' ? 'Toi' : 'Claude'}
            </strong>
            <div>{turn.content}</div>
          </div>
        ))}

        <form onSubmit={sendFollowUp} style={{ marginTop: 16 }}>
          {error && <div className="alert error">{error}</div>}
          <div className="field">
            <label htmlFor="followup">Message de suivi</label>
            <textarea
              id="followup"
              rows={3}
              value={followUp}
              disabled={active}
              placeholder={
                active
                  ? 'Attends la fin du tour en cours…'
                  : 'Ex : ajoute aussi un test pour le cas 404, puis repousse.'
              }
              onChange={(e) => setFollowUp(e.target.value)}
            />
            <p className="hint">
              La session Claude est reprise avec tout son contexte et le même dossier de travail.
            </p>
          </div>
          <button className="btn" disabled={busy || active || !followUp.trim()}>
            {busy ? 'Envoi…' : 'Relancer l’agent'}
          </button>
        </form>
      </div>
    </>
  );
}

function EventLine({ event }: { event: TaskEvent }) {
  const p = (event.payload ?? {}) as Record<string, unknown>;

  switch (event.kind) {
    case 'assistant_text':
      return (
        <div className="ev text">
          <span className="ev-tag">claude</span>
          {String(p.text ?? '')}
        </div>
      );

    case 'thinking':
      return (
        <div className="ev">
          <span className="ev-tag">réflexion</span>
          <span style={{ color: 'var(--text-faint)', fontStyle: 'italic' }}>
            {truncate(String(p.text ?? ''), 400)}
          </span>
        </div>
      );

    case 'tool_use':
      return (
        <div className="ev tool">
          <span className="ev-tag">{String(p.name ?? 'outil')}</span>
          <details>
            <summary>{summarize(p.input)}</summary>
            <pre>{JSON.stringify(p.input, null, 2)}</pre>
          </details>
        </div>
      );

    case 'tool_result':
      return (
        <div className={`ev ${p.isError ? 'error' : ''}`}>
          <span className="ev-tag">{p.isError ? 'erreur' : 'résultat'}</span>
          <details>
            <summary>{truncate(String(p.text ?? ''), 120) || '(vide)'}</summary>
            <pre>{String(p.text ?? '')}</pre>
          </details>
        </div>
      );

    case 'log': {
      const level = String(p.level ?? 'info');
      return (
        <div className={`ev ${level === 'error' ? 'error' : level === 'warn' ? 'warn' : ''}`}>
          <span className="ev-tag">{level}</span>
          {String(p.message ?? '')}
        </div>
      );
    }

    case 'init':
      return (
        <div className="ev">
          <span className="ev-tag">session</span>
          {String(p.model ?? '')} · {String(p.tools ?? '?')} outils
        </div>
      );

    case 'result': {
      const cost = typeof p.totalCostUsd === 'number' ? ` · $${p.totalCostUsd.toFixed(4)}` : '';
      const turns = p.numTurns ? ` · ${p.numTurns} tours` : '';
      const seconds =
        typeof p.durationMs === 'number' ? ` · ${(p.durationMs / 1000).toFixed(1)}s` : '';
      return (
        <div className={`ev result ${p.isError ? 'error' : ''}`}>
          <span className="ev-tag">fin</span>
          {String(p.subtype ?? '')}
          {seconds}
          {turns}
          {cost}
        </div>
      );
    }

    case 'pushed':
      return (
        <div className="ev result">
          <span className="ev-tag">push</span>
          {String(p.branch ?? '')} @ {String(p.sha ?? '').slice(0, 7)}
        </div>
      );

    case 'status':
      return (
        <div className="ev">
          <span className="ev-tag">statut</span>
          {String(p.status ?? '')}
        </div>
      );

    case 'queued':
      return (
        <div className="ev">
          <span className="ev-tag">file</span>
          position {String(p.position ?? '?')}
        </div>
      );

    default:
      return (
        <div className="ev">
          <span className="ev-tag">{event.kind}</span>
          {JSON.stringify(event.payload)}
        </div>
      );
  }
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'file_path', 'pattern', 'path', 'description', 'url', 'prompt']) {
    if (typeof record[key] === 'string') return truncate(record[key] as string, 130);
  }
  return truncate(JSON.stringify(record), 130);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
