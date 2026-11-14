import { NextResponse } from 'next/server';
import { get3d, rewriteTileset } from '@/lib/vexcel';

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
    const body = await get3d(kind, new URL(req.url).searchParams);
    if (!body) return NextResponse.json({ error: 'Vexcel 3D API error' }, { status: 502 });
    const headers = { 'Cache-Control': 'private, max-age=31536000, immutable' };
    if (kind === 'tileset') {
      const json = rewriteTileset(body.toString('utf8'));
      return new NextResponse(json, { headers: { ...headers, 'Content-Type': 'application/json' } });
    }
    return new NextResponse(new Uint8Array(body), { headers: { ...headers, 'Content-Type': 'model/gltf-binary' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
