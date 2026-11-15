import { subscribe, validId, type RemoteCommand } from '@/lib/remoteHub';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// The screen listens here: each phone command arrives as one server-sent event.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return new Response('Unknown remote', { status: 404 });
  const enc = new TextEncoder();
  let unsubscribe = () => {};
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(enc.encode(data));
        } catch {
          /* closed */
        }
      };
      send('retry: 2000\n\n');
      unsubscribe = subscribe(params.id, (c: RemoteCommand) => send(`data: ${JSON.stringify(c)}\n\n`));
      ping = setInterval(() => send(': ping\n\n'), 15000); // keep proxies from closing an idle stream
      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      unsubscribe();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
