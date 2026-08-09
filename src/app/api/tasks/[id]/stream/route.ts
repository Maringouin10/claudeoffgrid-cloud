import { requireSession } from '@/lib/auth';
import { eventsSince, subscribeTask, type TaskEvent } from '@/lib/bus';
import { getTask } from '@/lib/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-sent events for one task. `?after=<id>` replays everything the client
 * missed, so a reconnect never loses a line of the agent's output.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;

  const { id } = await params;
  if (!getTask(id)) {
    return new Response('Tâche introuvable', { status: 404 });
  }

  const after = Number(new URL(req.url).searchParams.get('after') ?? '0') || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: TaskEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`id: ${event.id}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      // Tell proxies not to buffer, then replay the backlog.
      controller.enqueue(encoder.encode(': stream ouvert\n\n'));
      for (const event of eventsSince(id, after)) send(event);

      const unsubscribe = subscribeTask(id, send);
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          closed = true;
        }
      }, 20_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
