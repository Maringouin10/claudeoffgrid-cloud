import { executeTask } from './runner';
import { maxConcurrency } from './settings';
import { emitTaskEvent } from './bus';

interface QueueItem {
  taskId: string;
  prompt: string;
}

interface QueueState {
  pending: QueueItem[];
  active: Set<string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __cogQueue: QueueState | undefined;
}

function state(): QueueState {
  if (!globalThis.__cogQueue) {
    globalThis.__cogQueue = { pending: [], active: new Set() };
  }
  return globalThis.__cogQueue;
}

/** Queues one agent turn. Returns immediately; progress arrives over SSE. */
export function enqueue(taskId: string, prompt: string): void {
  const q = state();
  q.pending.push({ taskId, prompt });
  emitTaskEvent(taskId, 'queued', { position: q.pending.length });
  drain();
}

function drain(): void {
  const q = state();
  const limit = maxConcurrency();
  while (q.active.size < limit && q.pending.length > 0) {
    // Never run two turns of the same task at once: they share a workspace.
    const index = q.pending.findIndex((item) => !q.active.has(item.taskId));
    if (index === -1) break;
    const [item] = q.pending.splice(index, 1);
    q.active.add(item.taskId);

    void executeTask(item.taskId, item.prompt)
      .catch((err) => {
        emitTaskEvent(item.taskId, 'log', {
          level: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(() => {
        q.active.delete(item.taskId);
        drain();
      });
  }
}

export function queueSnapshot(): { pending: number; active: number } {
  const q = state();
  return { pending: q.pending.length, active: q.active.size };
}
