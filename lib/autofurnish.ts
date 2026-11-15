import { checkFit } from './fit';
import { polygonArea } from './geometry';
import { flowContext, reachableTargets, type FlowContext } from './circulation';
import { closetOpenings, isInteriorWall } from './closets';
import { flowClear, isOpenDining, OPEN_DINING, sceneIssues, solveLayout, TEMPLATES, type Placement, type Role, type RoomType, type SceneInfo } from './solver';
import type { DoorMark, Pano, Product, Room, ThemeId, Vec2, Wall } from './types';

// One-click starting layouts: pick products for a room from its type and size (a small
// recommender), then try several layouts and keep the one that fits best. The result is an
// ordinary design the user can then move, rotate, swap or delete.

// What a room is for, from its label and size. null = not something we furnish.
export function furnishableType(room: Room): RoomType | null {
  const l = room.label.toLowerCase();
  const area = room.areaM2 || polygonArea(room.polygon);
  if (/kitchen/.test(l)) return area >= 30 ? 'living' : null; // a big "kitchen" is an open-plan living space
  if (/bath|closet|laundry|garage|stair|hall|pantry|utility|patio|balcony|porch|foyer|entry|mud|toilet|powder|storage|void|deck|yard/.test(l)) return null;
  if (/bed|nursery|guest/.test(l)) return 'bedroom';
  if (/dining|breakfast/.test(l)) return 'dining';
  if (/office|study|den|library/.test(l)) return 'office';
  if (/living|family|great|lounge|sitting|media|rec|bonus|loft/.test(l)) return 'living';
  return area >= 9 ? 'living' : null; // unlabelled rooms: furnish only if roomy
}

// Starting budget grows with the room.
function budgetFor(type: RoomType, area: number): number {
  const base = { living: 1500, bedroom: 1100, dining: 800, office: 600 }[type];
  const perM2 = { living: 60, bedroom: 45, dining: 35, office: 30 }[type];
  return Math.round(base + perM2 * Math.min(area, 40));
}

// Size-aware template: small rooms keep the essentials, big living rooms lean to a sectional.
function rolesFor(type: RoomType, area: number, open = false): Role[] {
  let roles = open ? OPEN_DINING : TEMPLATES[type];
  // Hung pieces take no floor, so a small room keeps them; a tiny one stays to the essentials.
  if (area < 9) roles = roles.filter((r) => !r.optional);
  else if (area < 13) roles = roles.filter((r) => !r.optional || r.role === 'plant' || r.wall);
  if (type === 'living' && area >= 24) roles = roles.map((r) => (r.role === 'sofa' ? { ...r, alts: ['sectional', 'sofa'] } : r));
  return roles;
}

const realModel = (p: Product) => p.retailer === 'ikea' && /^https:\/\/www\.ikea\.com\//.test(p.url);

export type Pick = { role: string; product: Product; alternatives: Product[] };

// Score every candidate for each role and take the best. Higher is better.
export function recommend(room: Room, type: RoomType, products: Product[], theme: ThemeId | null, budget: number): Pick[] {
  const longest = Math.max(room.widthM, room.depthM);
  const shortest = Math.min(room.widthM, room.depthM) || longest;
  const picks: Pick[] = [];
  let spent = 0;
  let anchorStyles: ThemeId[] = [];
  for (const [i, role] of rolesFor(type, room.areaM2, isOpenDining(room)).entries()) {
    const count = role.count ?? 1;
    const share = budget * role.weight;
    const anchorRole = i === 0;
    const scored = products
      .filter((p) => role.alts.includes(p.category) && p.placement === (role.wall ? 'wall' : 'floor'))
      // A flower pot for a table or counter is a small vase or potted plant; a floor plant is a real one.
      .filter((p) => (role.raised ? p.dimsCm.h <= 45 && p.dimsCm.w <= 35 && (p.category === 'plant' || /vase|\bpot\b|planter/i.test(p.name)) : p.category !== 'plant' || p.dimsCm.h >= 60))
      // Leave a walkway; the main piece (bed, sofa, desk) may make do with a tighter one.
      .filter((p) => p.dimsCm.w / 100 <= longest - 0.5 && p.dimsCm.d / 100 <= shortest - (anchorRole ? 0.45 : 0.6))
      .filter((p) => !room.heightM || p.dimsCm.h / 100 < room.heightM - 0.1)
      .map((p) => {
        let s = 0;
        if (theme && p.styles.includes(theme)) s += 3;
        else if (anchorStyles.some((t) => p.styles.includes(t))) s += 1.5; // match the main piece
        if (realModel(p)) s += 4; // real textured 3D model: looks like it belongs in the photo
        const cost = p.priceUsd * count;
        s += cost <= share ? 1 : -Math.min(3, (cost - share) / Math.max(share, 1));
        if (anchorRole) s -= (2 * Math.abs(p.dimsCm.w / 100 - longest * 0.55)) / (longest * 0.55); // sofa/bed sized to the main wall
        s += role.alts.indexOf(p.category) === 0 ? 0.3 : 0;
        // Paintings read best about a metre wide; a bedroom mirror should be a full-length dressing mirror.
        if (role.role === 'wall art') s -= 1.5 * Math.abs(p.dimsCm.w / 100 - 1);
        if (role.role === 'mirror') s += p.dimsCm.h >= 150 ? 1.5 : 0;
        return { p, s };
      })
      .sort((a, b) => b.s - a.s);
    const best = scored.find(({ p }) => spent + p.priceUsd * count <= budget * 1.1);
    if (!best && anchorRole) return []; // no bed or sofa fits: don't furnish with accessories alone
    if (!best) continue;
    if (anchorRole) anchorStyles = best.p.styles;
    for (let n = 0; n < count; n++) picks.push({ role: role.role, product: best.p, alternatives: scored.filter((x) => x.p !== best.p).slice(0, 3).map((x) => x.p) });
    spent += best.p.priceUsd * count;
  }
  return picks;
}

// Pieces that belong against a wall; the rest (tables, rugs, chairs) float by design.
const WALL_ROLES = new Set(['sofa', 'tv console', 'shelf', 'bed', 'dresser', 'desk']);

function distToWall(p: { x: number; y: number }, poly: { x: number; y: number }[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return d;
}

// Lower is better: fit problems first, then lost pieces, then pieces that should hug a wall but float.
function layoutCost(
  placed: Placement[],
  dropped: number,
  room: Room,
  products: Map<string, Product>,
  doors: DoorMark[],
  walls?: Record<string, Wall[]>,
  flow?: FlowContext,
  scene?: SceneInfo,
): number {
  const withUid = placed.map((p, i) => ({ item: { ...p, uid: String(i) }, product: products.get(p.productId)! }));
  const issues = checkFit(withUid, [room], doors, walls);
  let cost = issues.filter((i) => i.level === 'error').length * 1000 + issues.filter((i) => i.level === 'warn').length * 60 + dropped * 120;
  if (flow && !flowClear(room, placed, products, flow)) cost += 800; // a blocked doorway or route
  if (scene) cost += sceneIssues(placed, products, scene).length * 1000;
  for (const p of placed) {
    if (!WALL_ROLES.has(p.role)) continue;
    const pr = products.get(p.productId)!;
    cost += Math.max(0, distToWall(p.pos, room.polygon) - pr.dimsCm.d / 200 - 0.15) * 40;
  }
  return cost;
}

export type AutoResult = {
  type: RoomType;
  placed: Placement[];
  dropped: { role: string; product: Product; reason: string }[];
  picks: Pick[];
  budget: number;
  spent: number;
  tried: number;
};

// rooms + panos (the whole scan) let the layout keep doorways and walking routes clear.
// sense: what the scan mesh shows in this room (scanSense.ts). Its doorways replace the
// pano-based guesses, and its windows and fixtures constrain the layout.
export function autoFurnish(
  room: Room,
  products: Product[],
  opts: {
    doors?: DoorMark[];
    walls?: Record<string, Wall[]>;
    theme?: ThemeId | null;
    rooms?: Room[];
    panos?: Pano[];
    sense?: { doors: { mid: Vec2; widthM: number }[]; windows: { a: Vec2; b: Vec2 }[]; fixtures: Vec2[][]; probe?: SceneInfo['probe']; counters?: SceneInfo['counters'] } | null;
  } = {},
): AutoResult | null {
  const type = furnishableType(room);
  if (!type) return null;
  const sense = opts.sense ?? null;
  const seen: DoorMark[] = (sense?.doors ?? []).map((d, i) => ({ uid: `scan-${i}`, roomId: room.id, pos: d.mid, widthM: d.widthM }));
  // Closets, pantries and laundry rooms off this room count as doors: nothing may block their way in.
  const doors = [...(opts.doors ?? []), ...seen, ...closetOpenings(room, opts.rooms ?? [])];
  // An open-plan dining room gets a dining set and a lounge, so it starts from a living-room budget.
  const budget = isOpenDining(room) ? budgetFor('living', room.areaM2) + 600 : budgetFor(type, room.areaM2);
  const picks = recommend(room, type, products, opts.theme ?? null, budget);
  if (!picks.length) return null;
  const byId = new Map(picks.map((p) => [p.product.id, p.product]));
  const myDoors = doors.filter((d) => d.roomId === room.id).map((d) => d.pos);
  // With the scan's real doorways every one must stay reachable; without them, fall back to
  // guessing from panos and shared walls.
  const flow = sense
    ? reachableTargets(room, { stand: myDoors, shared: [], blockers: sense.fixtures })
    : opts.panos
      ? reachableTargets(room, flowContext(room, opts.rooms ?? [room], opts.panos, myDoors))
      : undefined;
  const scene: SceneInfo | undefined = sense ? { windows: sense.windows, fixtures: sense.fixtures, probe: sense.probe, counters: sense.counters } : undefined;

  // Try the main piece against each of the best few walls and keep the cheapest layout.
  let best: { placed: Placement[]; dropped: AutoResult['dropped']; cost: number } | null = null;
  const tries = isOpenDining(room) ? 9 : 4; // an open-plan room also tries each lounge wall
  for (let anchor = 0; anchor < tries; anchor++) {
    const r = solveLayout({ room, doors, picks, anchor, walls: opts.walls, flow, scene, interior: opts.rooms ? (a, b) => isInteriorWall(a, b, room, opts.rooms!) : undefined });
    const cost = layoutCost(r.placed, r.dropped.length, room, byId, doors, opts.walls, flow, scene);
    if (!best || cost < best.cost) best = { ...r, cost };
  }
  const spent = best!.placed.reduce((s, p) => s + (byId.get(p.productId)?.priceUsd ?? 0), 0);
  return { type, placed: best!.placed, dropped: best!.dropped, picks, budget, spent, tried: tries };
}
