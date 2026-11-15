import { NextResponse } from 'next/server';
import { getState, publish, setState, validId, type RemoteCommand, type RemoteState } from '@/lib/remoteHub';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['look', 'step', 'room', 'light', 'chat', 'furnished', 'frame', 'hello']);

// GET: the phone reads what the screen shows. POST { command }: the phone sends a command.
// POST { state } (from the screen): the screen publishes its state for the phone.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return NextResponse.json({ error: 'Unknown remote' }, { status: 404 });
  const fromPhone = new URL(req.url).searchParams.get('from') === 'phone';
  return NextResponse.json(getState(params.id, fromPhone), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!validId(params.id)) return NextResponse.json({ error: 'Unknown remote' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { command?: RemoteCommand; state?: RemoteState };
  if (body.state) {
    setState(params.id, body.state);
    return NextResponse.json({ ok: true, phoneSeen: getState(params.id).phoneSeen, now: Date.now() });
  }
  const c = body.command;
  if (!c || !TYPES.has(c.type)) return NextResponse.json({ error: 'Unknown command' }, { status: 400 });
  if (c.type === 'chat') c.text = String(c.text ?? '').slice(0, 500);
  if (c.type === 'look') {
    c.dx = Math.max(-90, Math.min(90, Number(c.dx) || 0));
    c.dy = Math.max(-60, Math.min(60, Number(c.dy) || 0));
  }
  const screens = publish(params.id, c);
  return NextResponse.json({ ok: true, delivered: screens > 0 });
}
