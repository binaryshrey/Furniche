import { NextResponse } from 'next/server';
import { runAgent, type ChatTurn } from '@/lib/agent';
import type { WorkDesign } from '@/lib/designOps';
import type { LightPrefs } from '@/lib/lighting';
import { photonAvailable, receivedSince, reply } from '@/lib/photon';
import type { Product } from '@/lib/types';

// The open editor calls this every few seconds with its current design. New iMessages to the
// Furniche agent are answered with that design as context, and any edits are handed back to the
// editor to apply, so a text like "swap the sofa for something cheaper" changes the 3D room live.

export const maxDuration = 60;

const g = globalThis as unknown as {
  __photon?: { since: string; seen: Set<string>; histories: Map<string, ChatTurn[]>; busy: boolean };
};
// Only messages that arrive after the server starts are answered.
const st = (g.__photon ??= { since: new Date().toISOString(), seen: new Set(), histories: new Map(), busy: false });

type Body = { sid: string; roomId: string | null; design: WorkDesign; imported: Product[]; lighting: LightPrefs };

export async function GET() {
  return NextResponse.json({ enabled: photonAvailable() });
}

export async function POST(req: Request) {
  if (!photonAvailable()) return NextResponse.json({ enabled: false, events: [] });
  if (st.busy) return NextResponse.json({ enabled: true, events: [] });
  const body = (await req.json()) as Body;
  if (!body.sid) return NextResponse.json({ enabled: true, events: [] });
  st.busy = true;
  try {
    // Look back a minute (listing is eventually consistent); the seen set drops repeats.
    const lookback = new Date(Math.max(Date.parse(st.since), Date.now() - 60_000)).toISOString();
    const inbound = (await receivedSince(lookback)).filter((m) => !st.seen.has(m.id) && m.at >= st.since);
    let design = body.design;
    let lighting = body.lighting;
    let designChanged = false;
    let lightChanged = false;
    const events: { from: string; text: string; reply: string; actions: string[]; suggestions: string[] }[] = [];
    for (const m of inbound) {
      st.seen.add(m.id);
      const history = st.histories.get(m.from) ?? [];
      const out = await runAgent({ sid: body.sid, roomId: body.roomId, design, imported: body.imported ?? [], lighting, history, message: m.text, channel: 'imessage' });
      if (out.design) {
        design = out.design;
        designChanged = true;
      }
      if (out.lighting) {
        lighting = out.lighting;
        lightChanged = true;
      }
      st.histories.set(m.from, [...history, { role: 'user' as const, text: m.text }, { role: 'assistant' as const, text: out.reply }].slice(-12));
      try {
        await reply(m, out.suggestions.length ? `${out.reply}\n\nYou could say: ${out.suggestions.slice(0, 3).map((x) => `"${x}"`).join(', ')}` : out.reply);
      } catch (e) {
        console.error('[photon] reply failed', (e as Error).message);
      }
      events.push({ from: m.from, text: m.text, reply: out.reply, actions: out.actions, suggestions: out.suggestions });
    }
    return NextResponse.json({ enabled: true, events, design: designChanged ? design : null, lighting: lightChanged ? lighting : null });
  } catch (e) {
    console.error('[photon]', (e as Error).message);
    return NextResponse.json({ enabled: true, events: [], error: (e as Error).message });
  } finally {
    st.busy = false;
  }
}
