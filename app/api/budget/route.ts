import { NextResponse } from 'next/server';
import { checkout, loadBudget, nessieAvailable, type CheckoutLine } from '@/lib/nessie';

// GET /api/budget?planned=1234 → the mover's budget from Capital One Nessie (or demo data).
export async function GET(req: Request) {
  const planned = Number(new URL(req.url).searchParams.get('planned')) || 0;
  return NextResponse.json(await loadBudget(planned));
}

// POST /api/budget { accountId, lines } → one Nessie purchase per store.
export async function POST(req: Request) {
  const body = (await req.json()) as { accountId?: string; lines?: CheckoutLine[] };
  if (!body.accountId || !body.lines?.length) return NextResponse.json({ error: 'Pick an account and add items first.' }, { status: 400 });
  if (!nessieAvailable()) return NextResponse.json({ error: 'Set NESSIE_API_KEY in .env.local to check out with Capital One.' }, { status: 400 });
  try {
    return NextResponse.json({ purchases: await checkout(body.accountId, body.lines) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
