import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORY_LABEL, PRODUCTS, RETAILER_LABEL } from '@/catalog/products';
import { MATERIALS, materialById } from '@/catalog/materials';
import { THEMES } from '@/catalog/themes';
import { swapped } from './alternatives';
import { demoBudget, type MoveInBudget } from './budget';
import { compactRoom, designTotal, fitToBudget, floorStats, furnishableRooms, issuesFor, optimizeRoom, placeFree, roomById, styleRoom, swapFor, type Ctx, type WorkDesign } from './designOps';
import { productFitsRoom } from './fit';
import { clampLight, type LightPrefs } from './lighting';
import { llmAvailable } from './llm';
import { getModelGeometry } from './matterport';
import { getBudget, nessieAvailable } from './nessie';
import { roomTypeOf, TEMPLATES } from './solver';
import type { Category, Product, Room, ThemeId } from './types';

// The Furniche chat agent. One brain for the in-app chat and for iMessage (Photon): it reads the
// open design, answers questions about pieces, price, look and light, and edits the design with
// tools. Edits are made to a working copy; the browser applies the result.

const MODEL = 'claude-opus-5-5';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };
export type AgentInput = {
  sid: string;
  roomId: string | null;
  design: WorkDesign;
  imported: Product[];
  lighting: LightPrefs;
  history: ChatTurn[];
  message: string;
  channel: 'web' | 'imessage';
};
export type AgentOutput = {
  reply: string;
  design: WorkDesign | null; // set when the design changed
  lighting: LightPrefs | null;
  actions: string[]; // short log of what changed, shown under the reply
  suggestions: string[]; // next steps offered as one-tap chips
  method: 'ai' | 'rules';
};

type State = { design: WorkDesign; lighting: LightPrefs; changedDesign: boolean; changedLight: boolean; actions: string[]; budget: MoveInBudget | null; focus?: string | null };

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const short = (p: Product) => p.name.split(',')[0];
// "Dining tables" -> "dining table", "Shelves" -> "shelf", "Benches" -> "bench", for sentences.
const one = (c: Category) => {
  const l = CATEGORY_LABEL[c].toLowerCase();
  return l === 'wall art' ? l : l.replace(/shelves$/, 'shelf').replace(/ches$/, 'ch').replace(/s$/, '');
};
const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const dims = (p: Product) => `${p.dimsCm.w}×${p.dimsCm.d}×${p.dimsCm.h} cm`;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// ---------- tools ----------

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'get_design',
    description: 'The current design: rooms with size and open floor, every placed piece (uid, product, price, room), fit problems, theme, lighting and totals. Call it before editing if you are unsure what is placed.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_products',
    description: 'Search the furniture catalogue. Returns product ids with price, size, styles and whether each fits the given room. Use before adding or swapping.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to match in the name, e.g. "oak", "linen sofa"' },
        category: { type: 'string', enum: Object.keys(CATEGORY_LABEL) },
        maxPriceUsd: { type: 'number' },
        style: { type: 'string', enum: THEMES.map((t) => t.id) },
        roomId: { type: 'string', description: 'Only return pieces that fit this room' },
        sort: { type: 'string', enum: ['price', 'size', 'relevance'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'add_furniture',
    description: 'Add a product to a room. It is placed automatically at the best open spot that passes the fit check (walls, overlaps, walkways, doorways).',
    input_schema: {
      type: 'object',
      properties: { productId: { type: 'string' }, roomId: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 8 } },
      required: ['productId'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_furniture',
    description: 'Remove pieces by uid, or every piece of a category or product in a room, or clear a room entirely.',
    input_schema: {
      type: 'object',
      properties: {
        uids: { type: 'array', items: { type: 'string' } },
        category: { type: 'string', enum: Object.keys(CATEGORY_LABEL) },
        productId: { type: 'string' },
        roomId: { type: 'string' },
        clearRoom: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'swap_furniture',
    description: 'Replace one placed piece with another product in the same spot (e.g. a cheaper or different-looking sofa).',
    input_schema: { type: 'object', properties: { uid: { type: 'string' }, productId: { type: 'string' } }, required: ['uid', 'productId'], additionalProperties: false },
  },
  {
    name: 'optimize_space',
    description:
      'Re-arrange a room to leave the most open floor with clear walkways. mode "arrange" keeps the chosen pieces (productIds, or what is in the room now) and finds the best layout. mode "compact" also swaps pieces for smaller ones of the same kind and style to free floor space. Reports open floor before and after.',
    input_schema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        productIds: { type: 'array', items: { type: 'string' }, description: 'The pieces the shopper wants in the room; repeat an id for several (e.g. 4 chairs). Omit to use what is there.' },
        mode: { type: 'string', enum: ['arrange', 'compact'] },
      },
      required: ['roomId'],
      additionalProperties: false,
    },
  },
  {
    name: 'style_room',
    description: 'Furnish a room from scratch for a theme and a budget, replacing what is in it.',
    input_schema: {
      type: 'object',
      properties: { roomId: { type: 'string' }, theme: { type: 'string', enum: THEMES.map((t) => t.id) }, budgetUsd: { type: 'number' } },
      required: ['roomId'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_finish',
    description: 'Paint or wallpaper a room\'s walls, or change its flooring. Returns quantity and cost.',
    input_schema: {
      type: 'object',
      properties: { roomId: { type: 'string' }, target: { type: 'string', enum: ['walls', 'floor'] }, materialId: { type: 'string', enum: MATERIALS.map((m) => m.id) }, remove: { type: 'boolean' } },
      required: ['roomId', 'target'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_theme',
    description: 'Set the design\'s style theme (used by swaps and future picks).',
    input_schema: { type: 'object', properties: { theme: { type: 'string', enum: THEMES.map((t) => t.id) } }, required: ['theme'], additionalProperties: false },
  },
  {
    name: 'set_lighting',
    description: 'Change how the furniture is lit in the 3D view. brightness 0.3–2 (1 = the room\'s own light); warmth -1 cool daylight … 0 neutral … 1 warm lamp light.',
    input_schema: { type: 'object', properties: { brightness: { type: 'number' }, warmth: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'get_budget',
    description:
      'The shopper\'s Capital One accounts (Nessie): balances, upcoming bills, monthly income, what is safe to spend on furnishing without missing a bill, and a pay-now / pay-later plan for the current design total.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'swap_to',
    description: 'Swap every placed piece of a category (in a room, or everywhere) for a cheaper, a premium, or a different-style product that still fits in the same spot. Use for "something cheaper", "nicer sofa", "make the chairs japandi".',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: Object.keys(CATEGORY_LABEL) },
        roomId: { type: 'string' },
        want: { type: 'string', description: '"cheaper", "premium", or a theme id' },
      },
      required: ['category', 'want'],
      additionalProperties: false,
    },
  },
  {
    name: 'fit_budget',
    description: 'Bring the furniture total under a dollar target (default: what is safe to spend from get_budget) by swapping the priciest pieces for cheaper ones that fit, then dropping accessories.',
    input_schema: { type: 'object', properties: { targetUsd: { type: 'number' } }, additionalProperties: false },
  },
  {
    name: 'match_finishes',
    description: 'Paint the walls and lay the floor of a room in the finishes that suit its theme (or the style of its furniture).',
    input_schema: { type: 'object', properties: { roomId: { type: 'string' }, walls: { type: 'boolean' }, floor: { type: 'boolean' } }, additionalProperties: false },
  },
];

function search(input: any, ctx: Ctx, state: State): string {
  const q = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const room = roomById(ctx, input.roomId);
  let rows = ctx.products.filter((p) => p.placement !== 'outdoor');
  if (input.category) rows = rows.filter((p) => p.category === input.category);
  if (input.maxPriceUsd) rows = rows.filter((p) => p.priceUsd <= input.maxPriceUsd);
  if (input.style) rows = rows.filter((p) => p.styles.includes(input.style));
  if (room) rows = rows.filter((p) => productFitsRoom(p, room));
  const score = (p: Product) => q.filter((w) => `${p.name} ${p.category} ${p.styles.join(' ')} ${p.retailer}`.toLowerCase().includes(w)).length;
  if (q.length) rows = rows.filter((p) => score(p) > 0);
  rows.sort((a, b) =>
    input.sort === 'price' ? a.priceUsd - b.priceUsd : input.sort === 'size' ? a.dimsCm.w * a.dimsCm.d - b.dimsCm.w * b.dimsCm.d : score(b) - score(a) || a.priceUsd - b.priceUsd,
  );
  if (!rows.length) return 'No products match. Try a broader search.';
  const theme = state.design.themeId;
  return rows
    .slice(0, 14)
    .map((p) => `${p.id} | ${p.name} | ${RETAILER_LABEL[p.retailer]} | ${usd(p.priceUsd)} | ${dims(p)} | ${p.styles.join(',')}${theme && p.styles.includes(theme) ? ' (matches theme)' : ''}`)
    .join('\n');
}

function describeDesign(ctx: Ctx, state: State, roomId: string | null): string {
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const issues = issuesFor(state.design, ctx);
  const rooms = furnishableRooms(ctx.geometry);
  const lines: string[] = [];
  lines.push(`Home: ${ctx.geometry.address ?? ctx.geometry.name}. Shopper is standing in: ${roomById(ctx, roomId)?.label ?? 'no room yet'} (${roomId ?? '-'}).`);
  lines.push(`Theme: ${state.design.themeId ?? 'none'}. Lighting: brightness ${state.lighting.brightness.toFixed(2)}, warmth ${state.lighting.warmth.toFixed(2)}.`);
  for (const r of rooms) {
    const st = floorStats(r, state.design.items, ctx.products);
    lines.push(
      `\nRoom ${r.id} "${r.label}": ${r.widthM.toFixed(2)} × ${r.depthM.toFixed(2)} m, ${r.areaM2.toFixed(1)} m², ceiling ${r.heightM?.toFixed(2) ?? '?'} m, open floor ${Math.round(st.freeShare * 100)}% (${st.freeM2.toFixed(1)} m²).`,
    );
    for (const it of state.design.items.filter((i) => i.roomId === r.id)) {
      const p = byId.get(it.productId);
      if (!p) continue;
      const mine = issues.filter((i) => i.uid === it.uid).map((i) => i.message);
      lines.push(`  - uid ${it.uid}: ${p.id} ${short(p)} (${CATEGORY_LABEL[p.category]}, ${usd(p.priceUsd)}, ${dims(p)}, ${p.styles.join('/')})${mine.length ? ' ⚠ ' + mine.join('; ') : ''}`);
    }
    for (const s of state.design.surfaces.filter((x) => x.roomId === r.id)) lines.push(`  - ${typeof s.target === 'string' ? s.target : 'wall'}: ${materialById(s.materialId)?.name ?? s.materialId}`);
  }
  const loose = state.design.items.filter((i) => !rooms.some((r) => r.id === i.roomId));
  if (loose.length) lines.push(`\nPieces in other areas: ${loose.length}.`);
  lines.push(`\nFurniture total: ${usd(designTotal(state.design, ctx.products))}. Fit problems: ${issues.filter((i) => i.level === 'error').length} errors, ${issues.filter((i) => i.level === 'warn').length} warnings.`);
  return lines.join('\n');
}

async function loadBudget(state: State, ctx: Ctx): Promise<MoveInBudget> {
  const planned = designTotal(state.design, ctx.products);
  if (!nessieAvailable()) return demoBudget(planned);
  try {
    return await getBudget(planned);
  } catch (e) {
    console.error('[agent] nessie', (e as Error).message);
    return demoBudget(planned);
  }
}

function budgetText(b: MoveInBudget): string {
  const acct = b.accounts.map((a) => `${a.nickname} (${a.type}): ${usd(a.type === 'Credit Card' ? (a.creditLimit ?? 0) - a.balance : a.available)} ${a.type === 'Credit Card' ? 'available credit' : 'available'}`);
  return [
    `Source: ${b.source === 'nessie' ? 'Capital One Nessie sandbox' : 'demo numbers (no Nessie key)'}`,
    ...acct,
    `Monthly income ${usd(b.monthlyIncome)}; monthly bills ${usd(b.monthlyBills)} (${b.bills.map((x) => `${x.payee} ${usd(x.amount)}`).join(', ')}).`,
    `Safe to spend on furnishing now: ${usd(b.safeToSpend)} (checking after bills and a $500 cushion ${usd(b.cashFree)} + 40% of savings ${usd(b.savingsShare)}). Card room under 30% use: ${usd(b.cardRoom)}.`,
    `Current design total ${usd(b.planned)} → ${b.status}.`,
    `Plan: ${b.plan.map((p) => `${p.label}: ${usd(p.amount)}`).join('; ') || 'nothing to pay yet'}.`,
    ...b.notes,
  ].join('\n');
}

function resolveRoom(ctx: Ctx, input: any, fallback: string | null) {
  return roomById(ctx, input.roomId) ?? roomById(ctx, fallback);
}

async function runTool(name: string, input: any, ctx: Ctx, state: State, roomId: string | null): Promise<string> {
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const touched = roomById(ctx, input.roomId) ?? (name !== 'get_design' && name !== 'get_budget' && name !== 'search_products' ? roomById(ctx, roomId) : null);
  if (touched) state.focus = touched.id;
  const commit = (d: WorkDesign, action: string) => {
    state.design = d;
    state.changedDesign = true;
    state.actions.push(action);
  };
  switch (name) {
    case 'get_design':
      return describeDesign(ctx, state, roomId);
    case 'search_products':
      return search(input, ctx, state);
    case 'add_furniture': {
      const p = byId.get(input.productId);
      const room = resolveRoom(ctx, input, roomId);
      if (!p) return `Unknown product ${input.productId}. Search first.`;
      if (!room) return 'Which room? Give a roomId.';
      if (p.placement === 'wall') return `${short(p)} hangs on a wall; ask the shopper to drag it from the Shop panel onto the wall they want.`;
      const added: string[] = [];
      let d = state.design;
      for (let n = 0; n < (input.quantity ?? 1); n++) {
        const spot = placeFree(p, room, d, ctx);
        if (!spot) break;
        d = { ...d, items: [...d.items, spot] };
        added.push(spot.uid);
      }
      if (!added.length) return `${short(p)} (${dims(p)}) has no open spot in the ${room.label} that keeps walkways clear. Suggest removing something, a smaller piece, or optimize_space.`;
      commit(d, `Added ${added.length} × ${short(p)} to ${room.label}`);
      const st = floorStats(room, d.items, ctx.products);
      return `Added ${added.length} × ${short(p)} (${usd(p.priceUsd)} each) to ${room.label}; uids ${added.join(', ')}. Open floor now ${Math.round(st.freeShare * 100)}%. New total ${usd(designTotal(d, ctx.products))}.`;
    }
    case 'remove_furniture': {
      const room = roomById(ctx, input.roomId);
      const gone = state.design.items.filter((i) => {
        const p = byId.get(i.productId);
        if (input.uids?.includes(i.uid)) return true;
        if (room && i.roomId !== room.id) return false;
        if (input.clearRoom && room) return true;
        if (input.productId && i.productId === input.productId) return true;
        if (input.category && p?.category === input.category) return true;
        return false;
      });
      if (!gone.length) return 'Nothing matched. Call get_design for uids.';
      commit({ ...state.design, items: state.design.items.filter((i) => !gone.includes(i)) }, `Removed ${gone.length} piece${gone.length > 1 ? 's' : ''}`);
      return `Removed ${gone.map((g) => short(byId.get(g.productId)!)).join(', ')}. New total ${usd(designTotal(state.design, ctx.products))}.`;
    }
    case 'swap_furniture': {
      const item = state.design.items.find((i) => i.uid === input.uid);
      const to = byId.get(input.productId);
      const from = item && byId.get(item.productId);
      if (!item || !to || !from) return 'Unknown uid or product.';
      const next = { ...swapped(item, from, to), uid: item.uid };
      const d = { ...state.design, items: state.design.items.map((i) => (i.uid === item.uid ? next : i)) };
      const problems = issuesFor(d, ctx).filter((i) => i.uid === item.uid);
      commit(d, `Swapped ${short(from)} → ${short(to)}`);
      return `Swapped ${short(from)} (${usd(from.priceUsd)}) for ${short(to)} (${usd(to.priceUsd)}).${problems.length ? ' Fit: ' + problems.map((p) => p.message).join('; ') : ' It fits.'}`;
    }
    case 'optimize_space': {
      const room = resolveRoom(ctx, input, roomId);
      if (!room) return 'Which room?';
      const before = floorStats(room, state.design.items, ctx.products);
      if (input.mode === 'compact') {
        const r = compactRoom(room, state.design, ctx);
        commit(r.design, `Compacted ${room.label}`);
        return `Compacted the ${room.label}: ${r.swaps.length ? r.swaps.map((s) => `${s.from} → ${s.to} (−${s.savedM2.toFixed(2)} m²)`).join('; ') : 'no smaller matching pieces'}. Open floor ${Math.round(before.freeShare * 100)}% → ${Math.round(r.stats.freeShare * 100)}%.${r.dropped.length ? ' Left out: ' + r.dropped.map((d) => `${d.name} (${d.reason})`).join('; ') : ''}`;
      }
      const ids: string[] = input.productIds?.length ? input.productIds : state.design.items.filter((i) => i.roomId === room.id).map((i) => i.productId);
      if (!ids.length) return `The ${room.label} is empty. Ask what pieces they want, or use style_room.`;
      const r = optimizeRoom(room, ids, state.design, ctx);
      commit(r.design, `Optimised layout of ${room.label}`);
      return `Laid out ${r.placed} pieces in the ${room.label} after comparing 4 layouts. Open floor ${Math.round(before.freeShare * 100)}% → ${Math.round(r.stats.freeShare * 100)}% (${r.stats.freeM2.toFixed(1)} of ${r.stats.areaM2.toFixed(1)} m²), walkways and doorways kept clear.${r.dropped.length ? ' Left out: ' + r.dropped.map((d) => `${d.name} (${d.reason})`).join('; ') : ''}`;
    }
    case 'style_room': {
      const room = resolveRoom(ctx, input, roomId);
      if (!room) return 'Which room?';
      const theme = (input.theme as ThemeId) ?? state.design.themeId;
      const budget = input.budgetUsd ?? (state.budget ? Math.max(500, state.budget.safeToSpend / 3) : 2500);
      const r = styleRoom(room, theme, budget, state.design, ctx);
      commit(r.design, `Styled ${room.label}${theme ? ' · ' + theme : ''}`);
      const spent = r.design.items.filter((i) => i.roomId === room.id).reduce((s, i) => s + (byId.get(i.productId)?.priceUsd ?? 0), 0);
      return `Furnished the ${room.label} (${theme ?? 'no theme'}, budget ${usd(budget)}): ${r.placed} pieces for ${usd(spent)}, open floor ${Math.round(r.stats.freeShare * 100)}%.${r.dropped.length ? ' Left out: ' + r.dropped.map((d) => d.name).join(', ') : ''}`;
    }
    case 'set_finish': {
      const room = resolveRoom(ctx, input, roomId);
      if (!room) return 'Which room?';
      const rest = state.design.surfaces.filter((s) => !(s.roomId === room.id && s.target === input.target));
      if (input.remove) {
        commit({ ...state.design, surfaces: rest }, `Removed ${input.target} finish in ${room.label}`);
        return 'Removed.';
      }
      const m = materialById(input.materialId);
      if (!m) return 'Unknown material.';
      if ((input.target === 'floor') !== (m.kind === 'floor')) return input.target === 'floor' ? 'Pick a flooring material.' : 'Pick a paint or wallpaper.';
      commit({ ...state.design, surfaces: [...rest, { uid: Math.random().toString(36).slice(2, 10), roomId: room.id, target: input.target, materialId: m.id }] }, `${m.name} on ${room.label} ${input.target}`);
      return `Set ${input.target} of ${room.label} to ${m.name} (${m.brand}, ${usd(m.priceUsd)}/${m.unit}). The design panel shows quantity and cost.`;
    }
    case 'set_theme': {
      commit({ ...state.design, themeId: input.theme }, `Theme: ${input.theme}`);
      return `Theme set to ${THEMES.find((t) => t.id === input.theme)?.name}.`;
    }
    case 'set_lighting': {
      state.lighting = clampLight(input, state.lighting);
      state.changedLight = true;
      state.actions.push(`Lighting: brightness ${state.lighting.brightness.toFixed(1)}, warmth ${state.lighting.warmth.toFixed(1)}`);
      return `Lighting now brightness ${state.lighting.brightness.toFixed(2)}, warmth ${state.lighting.warmth.toFixed(2)}.`;
    }
    case 'get_budget': {
      state.budget = await loadBudget(state, ctx);
      return budgetText(state.budget);
    }
    case 'swap_to': {
      const room = roomById(ctx, input.roomId);
      const targets = state.design.items.filter((i) => byId.get(i.productId)?.category === input.category && (!room || i.roomId === room.id));
      if (!targets.length) return `There is no ${one(input.category as Category)} placed${room ? ' in the ' + room.label : ''}.`;
      const done: string[] = [];
      let d = state.design;
      for (const t of targets) {
        const r = swapFor(d, t.uid, input.want, ctx);
        if (!r) continue;
        d = r.design;
        done.push(`${short(r.from)} (${usd(r.from.priceUsd)}) → ${short(r.to)} (${usd(r.to.priceUsd)})`);
      }
      if (!done.length) return `No ${input.want} option fits in the same spot. Try optimize_space first or a different room.`;
      commit(d, `Swapped ${done.length > 1 ? done.length + ' × ' : ''}${one(input.category as Category)}`);
      return `Swapped ${done.join('; ')}. New total ${usd(designTotal(d, ctx.products))}.`;
    }
    case 'fit_budget': {
      state.budget ??= await loadBudget(state, ctx);
      const target = input.targetUsd ?? state.budget.safeToSpend;
      const before = designTotal(state.design, ctx.products);
      if (before <= target) return `Already within ${usd(target)} (design is ${usd(before)}), ${usd(target - before)} to spare.`;
      const r = fitToBudget(state.design, target, ctx);
      if (!r.changes.length) return `Couldn't find cheaper pieces that fit. The design is ${usd(before)} against ${usd(target)}.`;
      commit(r.design, `Trimmed design to ${usd(r.total)}`);
      return `${r.met ? 'Now within' : 'Closer to'} ${usd(target)}: ${usd(before)} → ${usd(r.total)}. ${r.changes.join('; ')}.`;
    }
    case 'match_finishes': {
      const room = resolveRoom(ctx, input, roomId);
      if (!room) return 'Which room?';
      const theme = THEMES.find((t) => t.id === themeOfRoom(room.id, state, ctx)) ?? THEMES[0];
      let d = state.design;
      const done: string[] = [];
      const set = (target: 'walls' | 'floor', materialId: string) => {
        d = { ...d, surfaces: [...d.surfaces.filter((s) => !(s.roomId === room.id && s.target === target)), { uid: Math.random().toString(36).slice(2, 10), roomId: room.id, target, materialId }] };
        done.push(`${target} → ${materialById(materialId)?.name}`);
      };
      if (input.walls !== false) set('walls', theme.wallPaint);
      if (input.floor !== false) set('floor', theme.floor);
      commit(d, `${theme.name} finishes in ${room.label}`);
      return `Matched the ${room.label} to ${theme.name}: ${done.join(', ')}. ${theme.blurb}`;
    }
    default:
      return `Unknown tool ${name}`;
  }
}

// ---------- prompt ----------

const SYSTEM = `You are Furniche's design assistant. The shopper is furnishing a real home they are about to move into, inside its Matterport 3D scan, with real products at true size. You can see and edit their design with tools.

What you help with:
- Questions about pieces: size, price, store, style, whether something fits, what goes with what.
- Look and aesthetics: themes, palettes, materials, finishes, what would make a room feel bigger, calmer, warmer.
- Light: how light falls in the room, lamp and window placement, and the 3D view's lighting (set_lighting).
- Editing: add, remove, swap and re-arrange furniture; paint, wallpaper, flooring; themes.
- Space: optimize_space lays out the pieces the shopper chose for the most open floor with clear walkways; mode "compact" swaps in smaller pieces of the same style.
- Money: get_budget reads their Capital One accounts (Nessie) and says what they can afford now without missing rent or bills, and how to phase the rest.

How to work:
- Do the work, then report it. When the shopper asks for a change, make it with tools in this same turn: never answer with only a plan, a list of options, or "I can do X". Handle every part of a message ("add a rug and a lamp" means two additions). Pick sensible defaults (the room they are in, their theme, the closest cheaper option) instead of asking; ask only when a request truly cannot be resolved.
- For a question that suggests a change ("which wall colour goes with this?", "would a rug help?"), answer and apply your recommendation; they can undo it with one click.
- Use the tools rather than guessing. Product ids come only from search_products or get_design. When the shopper says "this room", use the room they are standing in.
- Every piece you add is placed automatically and passes the fit check; tell them where it went only if it matters.
- When a request costs money (adding pieces, styling a room), check the budget if they mention money, affordability, or a limit, and say how the new total compares with what is safe to spend.
- Keep replies short and concrete: a sentence or two, then the numbers that matter (price, size in cm or m, open floor, budget left). No markdown headings.
- If you cannot do something (outdoor pieces belong in the yard planner; wall art is hung by hand), say so plainly.

Themes: ${THEMES.map((t) => `${t.id} (${t.name}: ${t.blurb})`).join('; ')}.
Finishes: ${MATERIALS.map((m) => `${m.id} = ${m.name} ${m.kind} $${m.priceUsd}/${m.unit}`).join('; ')}.`;

const IMESSAGE_NOTE = 'This conversation is over iMessage. Plain text only, no markdown, no bullet symbols. Keep it to three short sentences at most. The shopper sees the design update live in the Furniche tab on their computer.';

// ---------- entry point ----------

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const geometry = await getModelGeometry(input.sid);
  const ctx: Ctx = { geometry, products: [...PRODUCTS, ...input.imported] };
  const state: State = { design: input.design, lighting: input.lighting, changedDesign: false, changedLight: false, actions: [], budget: null };

  const done = (reply: string, method: AgentOutput['method']): AgentOutput => ({
    reply,
    design: state.changedDesign ? state.design : null,
    lighting: state.changedLight ? state.lighting : null,
    actions: state.actions,
    suggestions: suggestNext(ctx, state, input.roomId, input.message),
    method,
  });

  // Tool output is written for the model; drop the internal piece ids before showing it directly.
  const forPeople = (s: string) => s.replace(/; uids [^.]*\./g, '.');
  if (!llmAvailable()) return done(forPeople(await rulesReply(input, ctx, state)), 'rules');

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...input.history.slice(-12).map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.BetaMessageParam),
    {
      role: 'user',
      content: [
        { type: 'text', text: `<design>\n${describeDesign(ctx, state, input.roomId)}\n</design>` },
        { type: 'text', text: input.message },
      ],
    },
  ];
  if (messages[0]?.role === 'assistant') messages.shift();

  try {
    for (let step = 0; step < 10; step++) {
      const response = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: [{ type: 'text', text: SYSTEM + (input.channel === 'imessage' ? '\n\n' + IMESSAGE_NOTE : ''), cache_control: { type: 'ephemeral' } }],
        tools,
        output_config: { effort: 'low' },
        messages,
      });
      if (response.stop_reason === 'refusal') return done('I can’t help with that one, but I’m happy to help with the room.', 'ai');
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (response.stop_reason !== 'tool_use') return done(text || 'Done.', 'ai');

      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: await runTool(block.name, block.input ?? {}, ctx, state, input.roomId) });
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${(e as Error).message}`, is_error: true });
        }
      }
      messages.push({ role: 'user', content: results });
    }
    return done('I made the changes I could. Ask me to keep going if something is missing.', 'ai');
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error('[agent] invalid Anthropic API key');
    else if (error instanceof Anthropic.RateLimitError) console.error('[agent] rate limited');
    else if (error instanceof Anthropic.APIError) console.error(`[agent] API error ${error.status}: ${error.message}`);
    else console.error('[agent] failed', error);
    return done(forPeople(await rulesReply(input, ctx, state)), 'rules');
  }
}

// ---------- shared helpers ----------

// The theme a room is styled in: the design's theme, else the style most of its pieces share.
function themeOfRoom(roomId: string, state: State, ctx: Ctx): ThemeId {
  if (state.design.themeId) return state.design.themeId;
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const count = new Map<ThemeId, number>();
  for (const i of state.design.items.filter((x) => x.roomId === roomId)) for (const s of byId.get(i.productId)?.styles ?? []) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'japandi';
}

const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

// Next steps offered as one-tap chips after every reply, from what the design needs now.
export function suggestNext(ctx: Ctx, state: State, roomId: string | null, last: string): string[] {
  const byId = new Map(ctx.products.map((p) => [p.id, p]));
  const rooms = furnishableRooms(ctx.geometry);
  const room = roomById(ctx, state.focus) ?? roomById(ctx, roomId) ?? rooms.find((r) => state.design.items.some((i) => i.roomId === r.id)) ?? rooms[0];
  const out: string[] = [];
  if (!room) return ['What can I afford?'];
  const name = room.label.toLowerCase();
  const mine = state.design.items.filter((i) => i.roomId === room.id).map((i) => byId.get(i.productId)).filter((p): p is Product => !!p);
  const cats = new Set(mine.map((p) => p.category));
  const total = designTotal(state.design, ctx.products);
  const theme = THEMES.find((t) => t.id === themeOfRoom(room.id, state, ctx))!;
  const budget = state.budget;
  const issues = issuesFor(state.design, ctx).filter((i) => i.level === 'error' && state.design.items.some((x) => x.uid === i.uid && x.roomId === room.id));

  if (!mine.length) {
    const per = budget ? roundTo(Math.min(budget.safeToSpend / 3, 4000), 500) : 2500;
    out.push(`Furnish the ${name} in ${theme.name} under $${per.toLocaleString()}`);
    const anchor = TEMPLATES[roomTypeOf(room.label)][0];
    out.push(`Add ${aOrAn(one(anchor.alts[0]))}`);
  }
  if (budget && total > budget.safeToSpend) out.push('Fit the design within my budget');
  if (issues.length) out.push(`Fix the fit problems in the ${name}`);
  if (mine.length) {
    const missing = TEMPLATES[roomTypeOf(room.label)].filter((r) => !r.alts.some((c) => cats.has(c))).slice(0, 2);
    for (const r of missing) out.push(r.count && r.count > 1 ? `Add ${['', '', 'two', 'three', 'four', 'five', 'six'][r.count] ?? r.count} ${one(r.alts[0])}s` : `Add ${aOrAn(one(r.alts[0]))}`);
    const priciest = [...mine].sort((a, b) => b.priceUsd - a.priceUsd)[0];
    if (priciest) out.push(`Swap the ${one(priciest.category)} for something cheaper`);
    if (!state.design.surfaces.some((s) => s.roomId === room.id)) out.push(`Paint the walls to match ${theme.name}`);
    if (floorStats(room, state.design.items, ctx.products).freeShare < 0.7) out.push(`Make the ${name} feel bigger`);
  }
  out.push(state.lighting.warmth > 0.2 ? 'Bright daylight' : 'Warmer evening light');
  if (!/afford|budget/i.test(last)) out.push('What can I afford?');
  const emptyOther = rooms.find((r) => r.id !== room.id && !state.design.items.some((i) => i.roomId === r.id));
  if (emptyOther && mine.length) out.push(`Furnish the ${emptyOther.label.toLowerCase()} too`);
  const seen = new Set<string>();
  return out.filter((s) => s.toLowerCase() !== last.trim().toLowerCase() && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase())).slice(0, 4);
}

// ---------- no-LLM engine: every part of a message is carried out ----------

// Most specific first; a match is blanked out so "chair" doesn't also match inside "armchair".
const CATEGORY_WORDS: [RegExp, Category][] = [
  [/\bsectionals?\b/, 'sectional'],
  [/\b(sofas?|couch(es)?|loveseats?|settees?)\b/, 'sofa'],
  [/\b(arm ?chairs?|accent chairs?|lounge chairs?|reading chairs?)\b/, 'armchair'],
  [/\b(office chairs?|desk chairs?)\b/, 'office-chair'],
  [/\bcoffee tables?\b/, 'coffee-table'],
  [/\b(side tables?|end tables?)\b/, 'side-table'],
  [/\b(bedside tables?|night ?stands?)\b/, 'nightstand'],
  [/\b(tv|media) (consoles?|stands?|benche?s?|units?)\b|\btv\b/, 'tv-console'],
  [/\b(book ?shel(f|ves)|book ?cases?|shel(f|ves)|shelving)\b/, 'bookshelf'],
  [/\bround tables?\b/, 'round-table'],
  [/\b(dining tables?|kitchen tables?|tables?)\b/, 'dining-table'],
  [/\b(bar stools?|stools?)\b/, 'bar-stool'],
  [/\b(dining chairs?|chairs?|seats?)\b/, 'dining-chair'],
  [/\b(dressers?|chests? of drawers)\b/, 'dresser'],
  [/\b(wardrobes?|armoires?)\b/, 'wardrobe'],
  [/\bbeds?\b/, 'bed'],
  [/\bdesks?\b/, 'desk'],
  [/\b(floor lamps?|lamps?)\b/, 'floor-lamp'],
  [/\b(rugs?|carpets?)\b/, 'rug'],
  [/\b(plants?|greenery|ficus)\b/, 'plant'],
  [/\bmirrors?\b/, 'mirror'],
  [/\b(wall art|art|paintings?|prints?|posters?)\b/, 'wall-art'],
  [/\bbench(es)?\b/, 'bench'],
];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, another: 1, two: 2, pair: 2, couple: 2, three: 3, four: 4, five: 5, six: 6 };

function findCategories(clause: string): { cat: Category; qty: number }[] {
  let s = ` ${clause} `;
  const found: { cat: Category; qty: number; at: number }[] = [];
  for (const [re, cat] of CATEGORY_WORDS) {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(s))) {
      const before = s.slice(0, m.index).trim().split(/\s+/).slice(-2);
      const n = before.map((w) => Number(w) || NUMBER_WORDS[w]).filter(Boolean).pop() ?? 1;
      if (!found.some((f) => f.cat === cat)) found.push({ cat, qty: Math.min(8, n), at: m.index });
      s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length);
    }
  }
  return found.sort((a, b) => a.at - b.at).map(({ cat, qty }) => ({ cat, qty }));
}

// Split "add a rug, make it warmer and then check my budget" into separate requests. "and" splits
// only before a new verb, so "add a rug and a lamp" stays one request with two pieces.
const VERBS = 'add|put|place|remove|delete|swap|replace|make|paint|set|optimi[sz]e|style|furnish|change|show|check|fit|warm|bright|dim|get rid|move|give|use|what|how|can';
function clauses(message: string): string[] {
  return message
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(new RegExp(`\\s*(?:[,;.!?]+\\s*(?:and\\s+)?(?:then\\s+)?|\\band then\\b|\\bthen\\b|\\balso\\b|\\bplus\\b|\\band\\b(?=\\s+(?:${VERBS})))\\s*`))
    .map((c) => c.trim())
    .filter((c) => c.length > 1);
}

const money = (s: string) => Number(s.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/)?.[1]?.replace(/,/g, '') ?? NaN) * (/\$\s?[\d,.]+\s*k\b/.test(s) ? 1000 : 1) || undefined;

// Words in the message that narrow the product (colour, material, size).
const DESCRIPTORS = ['white', 'black', 'grey', 'gray', 'oak', 'walnut', 'birch', 'pine', 'teak', 'rattan', 'linen', 'velvet', 'leather', 'boucle', 'jute', 'wool', 'brass', 'metal', 'glass', 'marble', 'green', 'blue', 'beige', 'brown', 'round', 'small', 'large', 'modular'];

function pickProduct(cat: Category, clause: string, room: Room, state: State, ctx: Ctx): Product | null {
  const theme = themeOfRoom(room.id, state, ctx);
  const words = DESCRIPTORS.filter((w) => clause.includes(w));
  const cap = money(clause);
  let pool = ctx.products.filter((p) => p.category === cat && p.placement !== 'outdoor' && productFitsRoom(p, room));
  if (cap) pool = pool.filter((p) => p.priceUsd <= cap);
  const styled = THEMES.find((t) => clause.includes(t.name.toLowerCase()) || clause.includes(t.id));
  const score = (p: Product) =>
    words.filter((w) => p.name.toLowerCase().includes(w) || (w === 'small' && p.dimsCm.w < 120) || (w === 'large' && p.dimsCm.w > 180)).length * 10 +
    (p.styles.includes(styled?.id ?? theme) ? 4 : 0);
  const cheap = /cheap|budget|affordable|inexpensive|low[- ]cost/.test(clause);
  const fancy = /premium|nice|luxur|high[- ]end|best|designer/.test(clause);
  pool.sort((a, b) => score(b) - score(a) || (cheap ? a.priceUsd - b.priceUsd : fancy ? b.priceUsd - a.priceUsd : 0));
  if (!cheap && !fancy && pool.length > 2) {
    // Among equally good matches, take the middle price: a sensible default, not the extremes.
    const top = pool.filter((p) => score(p) === score(pool[0])).sort((a, b) => a.priceUsd - b.priceUsd);
    return top[Math.floor((top.length - 1) / 2)] ?? pool[0];
  }
  return pool[0] ?? null;
}

const COLOR_HINTS: [RegExp, string][] = [
  [/white|bright|clean/, 'paint-chalk-white'],
  [/cream|warm white|swiss/, 'paint-swiss-coffee'],
  [/greige|beige|neutral|taupe/, 'paint-greige'],
  [/sea ?salt|mint|pale green|soft green/, 'paint-sea-salt'],
  [/sage|green|olive/, 'paint-sage'],
  [/terracotta|clay|orange|rust/, 'paint-terracotta'],
  [/charcoal|dark grey|dark gray|grey|gray|iron/, 'paint-iron-grey'],
  [/navy|blue/, 'paint-navy'],
  [/stripe/, 'wp-linen-stripe'],
  [/botanical|leaf|floral|wallpaper/, 'wp-botanical'],
  [/grasscloth|texture/, 'wp-grasscloth'],
];
const FLOOR_HINTS: [RegExp, string][] = [
  [/herringbone|parquet/, 'floor-herringbone'],
  [/walnut|dark wood/, 'floor-walnut'],
  [/concrete|tile|stone|porcelain/, 'floor-concrete'],
  [/oak|light wood|vinyl|lvp|wood/, 'floor-white-oak'],
];

function roomIn(clause: string, ctx: Ctx, fallback: Room | null): Room | null {
  const rooms = furnishableRooms(ctx.geometry);
  const named = rooms.filter((r) => {
    const l = r.label.toLowerCase();
    return clause.includes(l) || (/\bbed ?room\b/.test(clause) && /bed/.test(l)) || (/\bliving\b|\blounge\b/.test(clause) && /living|family|great/.test(l)) || (/\bdining\b/.test(clause) && /dining/.test(l)) || (/\boffice\b|\bstudy\b/.test(clause) && /office|study|den/.test(l));
  });
  return named.find((r) => r.id === fallback?.id) ?? named[0] ?? fallback;
}

async function rulesReply(input: AgentInput, ctx: Ctx, state: State): Promise<string> {
  const rooms = furnishableRooms(ctx.geometry);
  const here = roomById(ctx, input.roomId) ?? rooms.find((r) => state.design.items.some((i) => i.roomId === r.id)) ?? rooms[0] ?? null;
  const replies: string[] = [];
  const run = (name: string, args: any, room: Room | null) => runTool(name, args, ctx, state, room?.id ?? null);

  for (const c of clauses(input.message)) {
    const room = roomIn(c, ctx, here);
    const cats = findCategories(c);
    const nonLamp = cats.filter((x) => x.cat !== 'floor-lamp');
    if (!room) {
      replies.push('Walk into a room first so I know where to work.');
      break;
    }

    if (/(fit|stay|keep|get|bring|trim|cut).*(budget|afford|(within|under|below) \$)|within (my )?budget|(within|under|below) \$[\d,]+ (total|overall)|under (my )?budget|cut (the )?costs?|save money|reduce (the )?(total|cost)|too expensive/.test(c)) {
      replies.push(await run('fit_budget', { targetUsd: money(c) }, room));
    } else if (/\b(afford|budget|spend|bank|capital one|accounts?|money|savings|paycheck)\b/.test(c)) {
      state.budget ??= await loadBudget(state, ctx);
      const b = state.budget;
      const left = b.safeToSpend - designTotal(state.design, ctx.products);
      replies.push(
        `You can safely spend ${usd(b.safeToSpend)} now: checking after ${usd(b.monthlyBills)} of bills and a $500 cushion, plus 40% of your savings` +
          `${b.source === 'nessie' ? ' (live from Capital One)' : ' (demo numbers)'}. The design is ${usd(designTotal(state.design, ctx.products))}, so ` +
          (left >= 0 ? `you have ${usd(left)} left.` : `it is ${usd(-left)} over; I can trim it to fit.`) +
          (b.cardRoom ? ` The card adds ${usd(b.cardRoom)} of room if you keep it under 30% used.` : '') +
          (b.notes[0] ? ` ${b.notes[0]}` : ''),
      );
    } else if (/\b(bright(er)?|dim(mer)?|darker|warm(er)?|cool(er)?|coz[yi]|evening|daylight|natural light|moody|lighting|reset (the )?light)/.test(c) && !nonLamp.length && !/wall|paint|colou?r|floor/.test(c)) {
      const d = { ...state.lighting };
      if (/reset/.test(c)) Object.assign(d, { brightness: 1, warmth: 0 });
      if (/bright|daylight|natural light/.test(c)) d.brightness += 0.35;
      if (/dim|dark|moody/.test(c)) d.brightness -= 0.3;
      if (/warm|coz|evening|moody/.test(c)) d.warmth = Math.max(d.warmth, 0) + 0.5;
      if (/cool|daylight/.test(c)) d.warmth = Math.min(d.warmth, 0) - 0.5;
      await run('set_lighting', d, room);
      replies.push(`Light in the 3D view is now ${state.lighting.warmth > 0.2 ? 'warmer' : state.lighting.warmth < -0.2 ? 'cooler, like daylight' : 'neutral'} at ${Math.round(state.lighting.brightness * 100)}% brightness.`);
      if (cats.some((x) => x.cat === 'floor-lamp') || /lamp/.test(c)) replies.push(await addPieces([{ cat: 'floor-lamp', qty: 1 }], c, room, ctx, state));
    } else if (/\b(walls?|paint|colou?rs?|wallpaper|accent wall)\b/.test(c) && !nonLamp.length) {
      const hint = COLOR_HINTS.find(([re]) => re.test(c))?.[1];
      if (hint) {
        await run('set_finish', { roomId: room.id, target: 'walls', materialId: hint }, room);
        replies.push(`Painted the ${room.label.toLowerCase()} walls ${materialById(hint)!.name}.`);
      } else replies.push(await run('match_finishes', { roomId: room.id, walls: true, floor: false }, room));
    } else if (/\b(floor(ing|s)?|hardwood|tiles?|vinyl|lvp|parquet)\b/.test(c) && !/floor lamp/.test(c) && !nonLamp.length && !/open floor|floor space/.test(c)) {
      const hint = FLOOR_HINTS.find(([re]) => re.test(c))?.[1];
      if (hint) {
        await run('set_finish', { roomId: room.id, target: 'floor', materialId: hint }, room);
        replies.push(`Laid ${materialById(hint)!.name} in the ${room.label.toLowerCase()}.`);
      } else replies.push(await run('match_finishes', { roomId: room.id, walls: false, floor: true }, room));
    } else if (/\b(finishes|match (the )?(room|finishes)|paint and floor)/.test(c)) {
      replies.push(await run('match_finishes', { roomId: room.id }, room));
    } else if (/optimi[sz]|more (floor )?space|feel (bigger|larger|roomier|spacious)|bigger|roomier|spacious|open (it )?up|maximi[sz]|declutter|re-?arrange|better layout|layout|fix (the )?fit|fix (the )?problems|walkways?/.test(c) && !/add|swap|replace/.test(c)) {
      if (!cats.length && !state.design.items.some((i) => i.roomId === room.id)) {
        await run('style_room', { roomId: room.id, theme: themeOfRoom(room.id, state, ctx), budgetUsd: money(c) }, room);
        const r = await run('optimize_space', { roomId: room.id, mode: 'compact' }, room);
        replies.push(`The ${room.label.toLowerCase()} was empty, so I furnished it with compact pieces. ${r.replace(/^Compacted the [^:]*: /, 'Swaps: ')}`);
        continue;
      }
      const compact = /bigger|larger|roomier|spacious|declutter|smaller|compact|open (it )?up|maximi/.test(c) && state.design.items.some((i) => i.roomId === room.id);
      const ids = cats.length ? cats.flatMap((x) => Array.from({ length: x.qty }, () => pickProduct(x.cat, c, room, state, ctx)?.id).filter(Boolean) as string[]) : undefined;
      replies.push(await run('optimize_space', { roomId: room.id, mode: compact && !ids ? 'compact' : 'arrange', productIds: ids }, room));
    } else if (THEMES.some((t) => c.includes(t.name.toLowerCase()) || c.includes(t.id)) && !cats.length) {
      const t = THEMES.find((x) => c.includes(x.name.toLowerCase()) || c.includes(x.id))!;
      replies.push(await run('style_room', { roomId: room.id, theme: t.id, budgetUsd: money(c) }, room));
      if (/finish|paint|everything|whole/.test(c)) replies.push(await run('match_finishes', { roomId: room.id }, room));
    } else if (/\b(furnish|fill|decorate|stage|style|do up)\b|design (this|the) room/.test(c) && !cats.length) {
      replies.push(await run('style_room', { roomId: room.id, theme: themeOfRoom(room.id, state, ctx), budgetUsd: money(c) }, room));
    } else if (/swap|replace|change|cheaper|less expensive|budget[- ]friendly|premium|nicer|upgrade|fancier|better|luxur|different/.test(c)) {
      const want = /cheaper|less expensive|budget|affordable|save/.test(c) ? 'cheaper' : /premium|nicer|upgrade|fancier|better|luxur/.test(c) ? 'premium' : (THEMES.find((t) => c.includes(t.name.toLowerCase()) || c.includes(t.id))?.id ?? 'cheaper');
      const byId = new Map(ctx.products.map((p) => [p.id, p]));
      const targets = cats.length
        ? cats.map((x) => x.cat)
        : [[...state.design.items.filter((i) => i.roomId === room.id)].sort((a, b) => (byId.get(b.productId)?.priceUsd ?? 0) - (byId.get(a.productId)?.priceUsd ?? 0)).map((i) => byId.get(i.productId)?.category)[0]].filter(Boolean) as Category[];
      if (!targets.length) replies.push(`The ${room.label.toLowerCase()} is empty, so there is nothing to swap yet.`);
      for (const cat of targets) {
        const placed = state.design.items.some((i) => byId.get(i.productId)?.category === cat && i.roomId === room.id);
        replies.push(placed ? await run('swap_to', { category: cat, roomId: room.id, want }, room) : await addPieces([{ cat, qty: 1 }], c, room, ctx, state));
      }
    } else if (/remove|delete|get rid|take (out|away)|drop|clear|empty|don't want|do not want|no more|without/.test(c)) {
      if (cats.length)
        for (const x of cats) {
          const byId = new Map(ctx.products.map((p) => [p.id, p]));
          const inRoom = state.design.items.some((i) => i.roomId === room.id && byId.get(i.productId)?.category === x.cat);
          const anywhere = state.design.items.some((i) => byId.get(i.productId)?.category === x.cat);
          if (inRoom) replies.push(await run('remove_furniture', { roomId: room.id, category: x.cat }, room));
          else if (anywhere) replies.push(await run('remove_furniture', { category: x.cat }, room));
          else replies.push(`There is no ${one(x.cat)} in the design to remove.`);
        }
      else if (/everything|all|clear|empty|whole/.test(c)) replies.push(await run('remove_furniture', { roomId: room.id, clearRoom: true }, room));
      else if (state.design.items.length) {
        const lastAdded = state.design.items[state.design.items.length - 1];
        replies.push(await run('remove_furniture', { uids: [lastAdded.uid] }, room));
      }
    } else if (cats.length && /how (big|much|wide|tall|long|deep)|what size|price of|cost of|dimensions|does .* fit|will .* fit/.test(c)) {
      const byId = new Map(ctx.products.map((p) => [p.id, p]));
      for (const x of cats) {
        const placed = state.design.items.find((i) => byId.get(i.productId)?.category === x.cat && i.roomId === room.id);
        const p = placed ? byId.get(placed.productId)! : pickProduct(x.cat, c, room, state, ctx);
        if (!p) replies.push(`No ${one(x.cat)} in the catalogue fits the ${room.label.toLowerCase()}.`);
        else replies.push(`${placed ? 'Your' : 'A good'} ${short(p)} is ${p.dimsCm.w}×${p.dimsCm.d} cm and ${p.dimsCm.h} cm tall, ${usd(p.priceUsd)} at ${RETAILER_LABEL[p.retailer]}. ${productFitsRoom(p, room) ? `It fits the ${room.widthM.toFixed(1)} × ${room.depthM.toFixed(1)} m room.` : 'It is too big for this room.'}${placed ? '' : ' Say "add it" to place one.'}`);
      }
    } else if (cats.length) {
      replies.push(await addPieces(cats, c, room, ctx, state));
    } else if (/add it|place it|yes|do it|go ahead|sure|ok(ay)?/.test(c) && input.history.length) {
      const prev = [...input.history].reverse().find((t) => t.role === 'user')?.text ?? '';
      const prevCats = findCategories(prev.toLowerCase());
      if (prevCats.length) replies.push(await addPieces(prevCats, prev.toLowerCase(), room, ctx, state));
    } else if (/what('s| is) (in|here)|summary|show (me )?(the )?design|what do i have|total|so far/.test(c)) {
      const byId = new Map(ctx.products.map((p) => [p.id, p]));
      const mine = state.design.items.filter((i) => i.roomId === room.id).map((i) => byId.get(i.productId)!).filter(Boolean);
      const st = floorStats(room, state.design.items, ctx.products);
      replies.push(
        mine.length
          ? `The ${room.label.toLowerCase()} has ${mine.map(short).join(', ')}: ${usd(mine.reduce((s, p) => s + p.priceUsd, 0))}, ${Math.round(st.freeShare * 100)}% of the floor open. Whole design ${usd(designTotal(state.design, ctx.products))}.`
          : `The ${room.label.toLowerCase()} is empty (${room.widthM.toFixed(1)} × ${room.depthM.toFixed(1)} m).`,
      );
    }
  }

  if (!replies.length) {
    return 'Tell me what to change and I’ll do it: add or remove pieces ("add two armchairs and a rug"), swap for cheaper or nicer ones, paint the walls, change the floor, make the room feel bigger, adjust the light, or fit everything within your Capital One budget. Pick one of the options below to start.';
  }
  return replies.join(' ');
}

async function addPieces(cats: { cat: Category; qty: number }[], clause: string, room: Room, ctx: Ctx, state: State): Promise<string> {
  const parts: string[] = [];
  const failed: string[] = [];
  for (const x of cats) {
    const p = pickProduct(x.cat, clause, room, state, ctx);
    if (!p) {
      failed.push(`no ${one(x.cat)} in the catalogue fits`);
      continue;
    }
    const res = await runTool('add_furniture', { productId: p.id, roomId: room.id, quantity: x.qty }, ctx, state, room.id);
    if (res.startsWith('Added')) parts.push(`${x.qty > 1 ? x.qty + ' × ' : ''}${short(p)} (${usd(p.priceUsd)}${x.qty > 1 ? ' each' : ''})`);
    else failed.push(`no open spot for the ${short(p)}`);
  }
  const st = floorStats(room, state.design.items, ctx.products);
  return [
    parts.length ? `Added ${parts.join(', ')} to the ${room.label.toLowerCase()}, placed clear of walkways. ${Math.round(st.freeShare * 100)}% of the floor is still open; design total ${usd(designTotal(state.design, ctx.products))}.` : '',
    failed.length ? `Couldn't add: ${failed.join('; ')}. Try "make the room feel bigger" first.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// Opening chips for the chat, before the shopper has typed anything.
export async function suggestFor(input: Pick<AgentInput, 'sid' | 'roomId' | 'design' | 'imported' | 'lighting'>): Promise<string[]> {
  const geometry = await getModelGeometry(input.sid);
  const ctx: Ctx = { geometry, products: [...PRODUCTS, ...input.imported] };
  const state: State = { design: input.design, lighting: input.lighting, changedDesign: false, changedLight: false, actions: [], budget: null };
  return suggestNext(ctx, state, input.roomId, '');
}
