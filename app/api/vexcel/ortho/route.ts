import { NextResponse } from 'next/server';
import { getOrtho, getProperty } from '@/lib/vexcel';

// Aerial image framed exactly like the property geometry, so the two line up.
export async function GET(req: Request) {
  const listing = new URL(req.url).searchParams.get('listing') ?? '';
  if (!/^\d{1,15}$/.test(listing)) return NextResponse.json({ error: 'Invalid listing id' }, { status: 400 });
  try {
    const img = await getOrtho(await getProperty(listing));
    return new NextResponse(img, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
