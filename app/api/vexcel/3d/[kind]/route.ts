import { NextResponse } from 'next/server';
import { get3d } from '@/lib/vexcel';

// Mirrors Vexcel's /v2/3d/ so the tileset's relative links resolve here. 3d-tiles-renderer picks
// a parser from the file extension, and Vexcel's links have none (./tileset?…, ./tile?…), so
// tilesets are rewritten to point at ./tileset.json?… and ./tile.glb?…, which this route accepts.
const KINDS: Record<string, 'tileset' | 'tile'> = {
  tileset: 'tileset',
  'tileset.json': 'tileset',
  tile: 'tile',
  'tile.glb': 'tile',
};

export async function GET(req: Request, { params }: { params: { kind: string } }) {
  const kind = KINDS[params.kind];
  if (!kind) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const res = await get3d(kind, new URL(req.url).searchParams);
    if (!res.ok) return NextResponse.json({ error: `Vexcel 3D API ${res.status}` }, { status: res.status === 404 ? 404 : 502 });
    const headers = { 'Cache-Control': 'private, max-age=86400' };
    if (kind === 'tileset') {
      const json = (await res.text()).replace(/"\.\/tileset\?/g, '"./tileset.json?').replace(/"\.\/tile\?/g, '"./tile.glb?');
      return new NextResponse(json, { headers: { ...headers, 'Content-Type': 'application/json' } });
    }
    return new NextResponse(res.body, { headers: { ...headers, 'Content-Type': 'model/gltf-binary' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
