import { NextResponse } from 'next/server';
import { city3dManifest } from '@/lib/vexcel';

// The city-wide overview (every tileset and mesh down to zoom 15, ~2,400 meshes / ~390 MB) that
// /sky preloads into the browser cache. Deeper detail streams on demand.
export async function GET() {
  try {
    const urls = await city3dManifest(15);
    return NextResponse.json({ base: '/api/vexcel/3d/', urls }, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
