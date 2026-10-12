import { route } from '@/lib/http';
import { subscribe } from '@/lib/events';

// Live updates (Server-Sent Events). Apps keep this open; when data changes the
// server sends a small "something changed" message and the app refreshes it
// through the normal API (which applies all permission checks).
export const dynamic = 'force-dynamic';

export const { GET, OPTIONS } = route({
  GET: async ({ req, auth }) => {
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        };
        send(': connected\n\n');
        const unsubscribe = subscribe(auth.orgId, (event) => send(`data: ${JSON.stringify(event)}\n\n`));
        const ping = setInterval(() => send(': ping\n\n'), 25_000);
        cleanup = () => {
          clearInterval(ping);
          unsubscribe();
        };
        req.signal.addEventListener('abort', () => {
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  },
});
