import { NextResponse } from 'next/server';
import { runAgent, suggestFor, type AgentInput } from '@/lib/agent';

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<AgentInput> & { suggestOnly?: boolean };
  if (!body.sid || !/^[A-Za-z0-9]{6,20}$/.test(body.sid)) return NextResponse.json({ error: 'Open a home first.' }, { status: 400 });
  const base = {
    sid: body.sid,
    roomId: body.roomId ?? null,
    design: body.design ?? { items: [], surfaces: [], doors: [], themeId: null },
    imported: body.imported ?? [],
    lighting: body.lighting ?? { brightness: 1, warmth: 0 },
    scenes: body.scenes,
  };
  if (body.suggestOnly) {
    try {
      return NextResponse.json({ suggestions: await suggestFor(base) });
    } catch {
      return NextResponse.json({ suggestions: [] });
    }
  }
  if (!body.message?.trim()) return NextResponse.json({ error: 'Type a message.' }, { status: 400 });
  try {
    const out = await runAgent({
      ...base,
      history: body.history ?? [],
      message: body.message.slice(0, 2000),
      channel: 'web',
    });
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
