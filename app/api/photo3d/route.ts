import { NextResponse } from 'next/server';
import { llmAvailable } from '@/lib/llm';
import { ENGINES, type Engine, follow, gpuSet, tokenSet } from '@/lib/photo3d';

// Photo to 3D. GET says what's set up. POST takes a photo (multipart `image`, plus `engine`:
// quick | detail) and streams the build's progress as one JSON event per line (lib/photo3d.ts),
// ending with {"type":"done"} or {"type":"error"}. The model is then at /api/photo3d/<id>/<engine>.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({ token: tokenSet(), identify: llmAvailable(), gpu: gpuSet() });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const image = form?.get('image');
  const engine = (form?.get('engine') ?? 'quick') as Engine;
  if (!(image instanceof Blob) || !image.size) return NextResponse.json({ error: 'Choose a photo first.' }, { status: 400 });
  if (!/^image\/(jpeg|png|webp)$/.test(image.type)) return NextResponse.json({ error: 'Use a JPEG, PNG or WebP photo.' }, { status: 415 });
  if (image.size > 15_000_000) return NextResponse.json({ error: 'That photo is too large (15 MB at most).' }, { status: 413 });
  if (!ENGINES.includes(engine)) return NextResponse.json({ error: 'Unknown engine.' }, { status: 400 });

  const photo = new Uint8Array(await image.arrayBuffer());
  const encoder = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      stop = follow(photo, engine, (e) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
        } catch {
          open = false; // the page has gone
        }
        if (e.type === 'done' || e.type === 'error') {
          open = false;
          queueMicrotask(() => {
            stop();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          });
        }
      });
    },
    // The page went away: stop sending. The build itself carries on and is cached.
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
