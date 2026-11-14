import { NextResponse } from 'next/server';
import { city3dManifest } from '@/lib/vexcel';

// Where Vexcel's 3D mesh actually exists: every zoom-15 mesh tile (XYZ scheme). The collection's
// bounding box has gaps, and a home in one would fly the camera into empty sky.
export async function GET() {
  try {
    const tiles = (await city3dManifest(15))
      .map((u) => u.match(/^tile\.glb\?zoom=15&tile-x=(\d+)&tile-y=(\d+)/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [Number(m[1]), Number(m[2])]);
    return NextResponse.json({ zoom: 15, tiles }, { headers: { 'Cache-Control': 'private, max-age=86400' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
