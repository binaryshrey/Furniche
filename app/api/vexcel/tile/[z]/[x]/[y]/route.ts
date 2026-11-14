import { NextResponse } from 'next/server';
import { getTile } from '@/lib/vexcel';

export async function GET(_req: Request, { params }: { params: { z: string; x: string; y: string } }) {
  const [z, x, y] = [params.z, params.x, params.y].map(Number);
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 21 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
    return NextResponse.json({ error: 'Invalid tile' }, { status: 400 });
  }
  try {
    const img = await getTile(z, x, y);
    if (!img) return new NextResponse(null, { status: 204 });
    return new NextResponse(img, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
