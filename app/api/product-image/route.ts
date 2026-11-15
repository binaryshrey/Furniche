import { ikeaImage } from '@/lib/ikea3d';

// Only IKEA's product-image CDN path may be proxied (so this can't be pointed at anything else).
const IKEA_IMAGES = /^https:\/\/www\.ikea\.com\/us\/en\/images\/products\/[A-Za-z0-9_.\-/]+\.(jpg|jpeg|png)$/i;

// Studio photo for a catalogue product (IKEA only for now). 404 lets the page fall back to its swatch.
// ?src=<an IKEA product image URL> serves that exact image from our origin, so the 3D view can use it
// as a texture (the CDN sends no CORS headers).
export async function GET(req: Request) {
  const u = new URL(req.url);
  const src = u.searchParams.get('src');
  if (src) {
    if (!IKEA_IMAGES.test(src)) return new Response(null, { status: 400 });
    try {
      const res = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) return new Response(null, { status: 404 });
      return new Response(new Uint8Array(await res.arrayBuffer()), {
        headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' },
      });
    } catch {
      return new Response(null, { status: 502 });
    }
  }
  const id = u.searchParams.get('id') ?? '';
  const name = u.searchParams.get('name') ?? '';
  if (!/^[a-z0-9-]{1,80}$/i.test(id) || !name) return new Response(null, { status: 400 });
  const img = await ikeaImage(id, name).catch(() => null);
  if (!img) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(img), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800, immutable' } });
}
