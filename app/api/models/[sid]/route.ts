import { NextResponse } from 'next/server';
import { getModelGeometry } from '@/lib/matterport';

export async function GET(_req: Request, { params }: { params: { sid: string } }) {
  if (!/^[A-Za-z0-9]{6,20}$/.test(params.sid)) {
    return NextResponse.json({ error: 'Invalid model id' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getModelGeometry(params.sid));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
