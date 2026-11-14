import { NextResponse } from 'next/server';
import { getProperty } from '@/lib/vexcel';

export async function GET(req: Request) {
  const listing = new URL(req.url).searchParams.get('listing') ?? '';
  if (!/^\d{1,15}$/.test(listing)) return NextResponse.json({ error: 'Invalid listing id' }, { status: 400 });
  try {
    return NextResponse.json(await getProperty(listing));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
