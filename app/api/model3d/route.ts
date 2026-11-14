import { NextResponse } from 'next/server';
import { ikeaModel } from '@/lib/ikea3d';

// Real 3D model for a product, when its store publishes one (IKEA today). 404 means "use the
// stand-in shape".
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get('id') ?? '';
  const url = q.get('url') ?? '';
  const name = (q.get('name') ?? '').slice(0, 160);
  if (!/^[a-z0-9-]{3,60}$/i.test(id) || !/^https:\/\/www\.ikea\.com\//.test(url)) {
    return NextResponse.json({ error: 'No model for this product' }, { status: 404 });
  }
  try {
    const glb = await ikeaModel(id, url, name);
    if (!glb) return NextResponse.json({ error: 'No model for this product' }, { status: 404 });
    return new NextResponse(new Uint8Array(glb), {
      headers: { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, max-age=604800' },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
