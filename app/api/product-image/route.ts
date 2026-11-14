import { ikeaImage } from '@/lib/ikea3d';

// Studio photo for a catalogue product (IKEA only for now). 404 lets the page fall back to its swatch.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';
  const name = u.searchParams.get('name') ?? '';
  if (!/^[a-z0-9-]{1,80}$/i.test(id) || !name) return new Response(null, { status: 400 });
  const img = await ikeaImage(id, name).catch(() => null);
  if (!img) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(img), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' } });
}
