import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PRODUCTS } from '@/catalog/products';
import { THEMES } from '@/catalog/themes';
import { llmAvailable, structured } from '@/lib/llm';
import { pickProducts, roomTypeOf, solveLayout, TEMPLATES } from '@/lib/solver';
import type { DoorMark, Product, Room, ThemeId } from '@/lib/types';

type Body = { room: Room; doors: DoorMark[]; prompt?: string; themeId?: ThemeId | null; budget?: number; extraProducts?: Product[] };

const Choice = z.object({
  themeId: z.enum(THEMES.map((t) => t.id) as [ThemeId, ...ThemeId[]]),
  budgetUsd: z.number().nullable().describe('Budget stated by the user in US dollars, or null if none'),
  picks: z.array(z.object({ role: z.string(), productId: z.string(), reason: z.string().describe('One short sentence') })),
  summary: z.string().describe('Two sentences describing the look, written to the shopper'),
});

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const { room, doors = [] } = body;
  if (!room?.polygon?.length) return NextResponse.json({ error: 'Walk into a room first.' }, { status: 400 });

  const type = roomTypeOf(room.label);
  const products = [...PRODUCTS, ...(body.extraProducts ?? [])];
  const budgetFromText = Number((body.prompt ?? '').match(/\$\s?([\d,]+)/)?.[1]?.replace(/,/g, '')) || null;
  let themeId: ThemeId | null = body.themeId ?? null;
  if (!themeId && body.prompt) {
    const p = body.prompt.toLowerCase();
    themeId = THEMES.find((t) => p.includes(t.name.toLowerCase()) || t.keywords.some((k) => p.includes(k)))?.id ?? null;
  }
  let budget = body.budget ?? budgetFromText ?? 3000;
  let picks = pickProducts(type, themeId, budget, room, products);
  let summary = '';
  let reasons: Record<string, string> = {};
  let method: 'ai' | 'rules' = 'rules';

  if (llmAvailable() && body.prompt) {
    const roles = TEMPLATES[type].map((r) => `${r.role}${r.count ? ` x${r.count}` : ''} (${r.alts.join(' or ')})${r.optional ? ' [optional]' : ''}`);
    const catalog = products
      .filter((p) => TEMPLATES[type].some((r) => r.alts.includes(p.category)) && p.placement === 'floor')
      .map((p) => `${p.id} | ${p.category} | ${p.name} | $${p.priceUsd} | ${p.dimsCm.w}x${p.dimsCm.d}x${p.dimsCm.h} cm | styles: ${p.styles.join(',')}`);
    const ai = await structured({
      system:
        'You are an interior stylist choosing real products for one room. Pick only product ids from the catalog. ' +
        'Respect the budget (total of all picks, counting each chair separately). Every piece must fit the room: ' +
        'width of the largest piece must be at least 0.6 m less than the longest wall. Skip optional roles when the room is small or the budget is tight. ' +
        'Return one pick per unit (four dining chairs means four picks). Do not choose positions; layout is done separately.',
      user:
        `Shopper request: ${body.prompt}\nRoom: ${room.label}, ${room.widthM.toFixed(2)} x ${room.depthM.toFixed(2)} m, ceiling ${room.heightM?.toFixed(2) ?? 'unknown'} m.\n` +
        `Default budget if none stated: $${budget}.\nRoles to fill:\n${roles.join('\n')}\n\nCatalog:\n${catalog.join('\n')}`,
      schema: Choice,
      effort: 'medium',
    });
    if (ai) {
      const byId = new Map(products.map((p) => [p.id, p]));
      const aiPicks = ai.picks
        .map((p) => ({ role: p.role, product: byId.get(p.productId) }))
        .filter((p): p is { role: string; product: Product } => !!p.product)
        .map((p) => ({ role: TEMPLATES[type].find((r) => r.alts.includes(p.product.category))?.role ?? p.role, product: p.product }));
      if (aiPicks.length) {
        picks = aiPicks;
        themeId = ai.themeId;
        budget = ai.budgetUsd ?? budget;
        summary = ai.summary;
        reasons = Object.fromEntries(ai.picks.map((p) => [p.productId, p.reason]));
        method = 'ai';
      }
    }
  }

  const { placed, dropped } = solveLayout({ room, doors, picks });
  const total = placed.reduce((s, p) => s + (products.find((x) => x.id === p.productId)?.priceUsd ?? 0), 0);
  if (!summary) {
    const theme = THEMES.find((t) => t.id === themeId);
    summary = `${theme ? theme.name + ' ' : ''}${room.label.toLowerCase()} for about $${Math.round(total).toLocaleString()}. Pieces were chosen to fit the ${room.widthM.toFixed(1)} × ${room.depthM.toFixed(1)} m room.`;
  }
  return NextResponse.json({
    method,
    themeId,
    budget,
    total,
    summary,
    placed: placed.map((p) => ({ productId: p.productId, roomId: p.roomId, pos: p.pos, rot: p.rot, reason: reasons[p.productId] ?? null })),
    dropped: dropped.map((d) => ({ role: d.role, name: d.product.name.split(',')[0], reason: d.reason })),
  });
}
