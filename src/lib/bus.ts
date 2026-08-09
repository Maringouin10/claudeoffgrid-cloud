import { EventEmitter } from 'node:events';
import { getDb } from './db';

export interface TaskEvent {
  id: number;
  taskId: string;
  kind: string;
  payload: unknown;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __cogBus: EventEmitter | undefined;
}

function bus(): EventEmitter {
  if (!globalThis.__cogBus) {
    const emitter = new EventEmitter();
    // One listener per open SSE connection, plus the runner's own.
    emitter.setMaxListeners(200);
    globalThis.__cogBus = emitter;
  }
  return globalThis.__cogBus;
}

/** Persists an event and pushes it to every open SSE stream for that task. */
export function emitTaskEvent(taskId: string, kind: string, payload: unknown): TaskEvent {
  const serialized = JSON.stringify(payload ?? null);
  const info = getDb()
    .prepare('INSERT INTO events (task_id, kind, payload) VALUES (?, ?, ?)')
    .run(taskId, kind, serialized);

  const event: TaskEvent = {
    id: Number(info.lastInsertRowid),
    taskId,
    kind,
    payload: payload ?? null,
    createdAt: new Date().toISOString(),
  };
  bus().emit(`task:${taskId}`, event);
  bus().emit('task:any', event);
  return event;
}

export function subscribeTask(taskId: string, listener: (event: TaskEvent) => void): () => void {
  const channel = `task:${taskId}`;
  bus().on(channel, listener);
  return () => bus().off(channel, listener);
}

export function subscribeAll(listener: (event: TaskEvent) => void): () => void {
  bus().on('task:any', listener);
  return () => bus().off('task:any', listener);
}

export function eventsSince(taskId: string, afterId: number): TaskEvent[] {
  const rows = getDb()
    .prepare('SELECT id, task_id, kind, payload, created_at FROM events WHERE task_id = ? AND id > ? ORDER BY id ASC')
    .all(taskId, afterId) as Array<{
    id: number;
    task_id: string;
    kind: string;
    payload: string;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    kind: r.kind,
    payload: safeParse(r.payload),
    createdAt: r.created_at,
  }));
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
