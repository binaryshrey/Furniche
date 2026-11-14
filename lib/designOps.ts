import { flowContext, reachableTargets } from './circulation';
import { checkFit, footprint } from './fit';
import { centroid, minDistToBoundary, pointInPolygon, polygonArea } from './geometry';
import { solveLayout, TEMPLATES, pickProducts, roomTypeOf, type RoomType } from './solver';
import { furnishableType } from './autofurnish';
import { alternatives } from './alternatives';
import type { DoorMark, ModelGeometry, PlacedItem, Product, Room, SurfaceChoice, ThemeId } from './types';

// Design edits the chat agent can make. Pure functions over a working copy of the design, so they
// run on the server and are unit-tested; the browser applies the resulting design.

export type WorkDesign = { items: PlacedItem[]; surfaces: SurfaceChoice[]; doors: DoorMark[]; themeId: ThemeId | null };
export type Ctx = { geometry: ModelGeometry; products: Product[] };

const uid = () => Math.random().toString(36).slice(2, 10);
const byIdOf = (products: Product[]) => new Map(products.map((p) => [p.id, p]));

export function roomById(ctx: Ctx, id: string | null | undefined): Room | null {
  return ctx.geometry.rooms.find((r) => r.id === id) ?? null;
}

export function furnishableRooms(geometry: ModelGeometry): Room[] {
  return geometry.rooms.filter((r) => furnishableType(r) || /living|bed|dining|office|family|great|study|den/i.test(r.label));
}

// Share of the room's floor left open (rugs and wall pieces don't count as taking floor).
export function floorStats(room: Room, items: PlacedItem[], products: Product[]) {
  const byId = byIdOf(products);
  const area = room.areaM2 || polygonArea(room.polygon);
  const used = items
    .filter((i) => i.roomId === room.id)
    .map((i) => byId.get(i.productId))
    .filter((p): p is Product => !!p && p.placement === 'floor' && p.category !== 'rug')
    .reduce((s, p) => s + (p.dimsCm.w / 100) * (p.dimsCm.d / 100), 0);
  return { areaM2: area, usedM2: used, freeM2: Math.max(0, area - used), freeShare: area ? Math.max(0, 1 - used / area) : 0 };
}

export function issuesFor(design: WorkDesign, ctx: Ctx) {
  const byId = byIdOf(ctx.products);
  const inputs = design.items.map((item) => ({ item, product: byId.get(item.productId)! })).filter((x) => x.product);
  return checkFit(inputs, ctx.geometry.rooms, design.doors, ctx.geometry.walls);
}

// Find the best open spot for one more piece: inside the room, clear of walls and other pieces,
// big pieces backed onto a wall, rugs near the middle. null when nothing fits.
export function placeFree(product: Product, room: Room, design: WorkDesign, ctx: Ctx): PlacedItem | null {
  const byId = byIdOf(ctx.products);
  const others = design.items.filter((i) => i.roomId === room.id).map((item) => ({ item, product: byId.get(item.productId)! })).filter((x) => x.product);
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(0.15, Math.max(x1 - x0, y1 - y0) / 24);
  const mid = centroid(room.polygon);
  const hugsWall = !['rug', 'coffee-table', 'dining-table', 'round-table', 'dining-chair', 'armchair', 'office-chair'].includes(product.category);
  let best: { item: PlacedItem; score: number } | null = null;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!pointInPolygon({ x, y }, room.polygon)) continue;
      for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const item: PlacedItem = { uid: 'candidate', productId: product.id, roomId: room.id, pos: { x, y, z: room.floorZ }, rot };
        const corners = footprint(item, product);
        if (corners.some((c) => !pointInPolygon(c, room.polygon))) continue;
        const issues = checkFit([...others, { item, product }], [room], design.doors, ctx.geometry.walls).filter((i) => i.uid === 'candidate');
        const errors = issues.filter((i) => i.level === 'error').length;
        if (errors) continue;
        const warns = issues.length;
        const wallGap = minDistToBoundary(corners, room.polygon);
        const toMid = Math.hypot(x - mid.x, y - mid.y);
        // Face into the room: the item's front is local -y, which rot turns toward the middle.
        const front = { x: Math.sin(rot), y: -Math.cos(rot) };
        const facing = ((mid.x - x) * front.x + (mid.y - y) * front.y) / (toMid || 1);
        const score = warns * 10 + (hugsWall ? wallGap * 4 - facing : toMid);
        if (!best || score < best.score) best = { item: { ...item, uid: uid() }, score };
      }
    }
  }
  return best?.item ?? null;
}

const roleFor = (type: RoomType, p: Product) => TEMPLATES[type].find((r) => r.alts.includes(p.category))?.role ?? p.category;

// Lay out a room with the given pieces (the shopper's own choice), trying each wall for the main
// piece and keeping the layout with the fewest problems and the most open floor. Pieces the
// templates don't know are added at the best free spot afterwards.
export function optimizeRoom(room: Room, productIds: string[], design: WorkDesign, ctx: Ctx) {
  const byId = byIdOf(ctx.products);
  const products = productIds.map((id) => byId.get(id)).filter((p): p is Product => !!p && p.placement !== 'outdoor');
  const type = roomTypeOf(room.label);
  const known = products.filter((p) => TEMPLATES[type].some((r) => r.alts.includes(p.category)) && p.placement === 'floor');
  const extra = products.filter((p) => !known.includes(p));
  const picks = known.map((p) => ({ role: roleFor(type, p), product: p }));
  const myDoors = design.doors.filter((d) => d.roomId === room.id).map((d) => d.pos);
  const flow = reachableTargets(room, flowContext(room, ctx.geometry.rooms, ctx.geometry.panos, myDoors));
  const rest = design.items.filter((i) => i.roomId !== room.id);

  let best: { items: PlacedItem[]; dropped: { name: string; reason: string }[]; cost: number } | null = null;
  for (let anchor = 0; anchor < 4; anchor++) {
    const r = picks.length ? solveLayout({ room, doors: design.doors, picks, anchor, walls: ctx.geometry.walls, flow }) : { placed: [], dropped: [] };
    const items: PlacedItem[] = r.placed.map((p) => ({ uid: uid(), productId: p.productId, roomId: room.id, pos: p.pos, rot: p.rot }));
    // solveLayout places one of each role; anything it skipped, or the templates don't cover, goes in a free spot.
    const placedCount = new Map<string, number>();
    items.forEach((i) => placedCount.set(i.productId, (placedCount.get(i.productId) ?? 0) + 1));
    const dropped = r.dropped.map((d) => ({ name: d.product.name.split(',')[0], reason: d.reason }));
    const wanted = new Map<string, number>();
    products.forEach((p) => wanted.set(p.id, (wanted.get(p.id) ?? 0) + 1));
    const droppedIds = new Set(r.dropped.map((d) => d.product.id));
    for (const p of [...known, ...extra]) {
      const have = placedCount.get(p.id) ?? 0;
      if (have >= (wanted.get(p.id) ?? 0) || droppedIds.has(p.id)) continue;
      placedCount.set(p.id, have + 1);
      if (p.placement === 'wall') continue; // hung by hand from the shop panel
      const spot = placeFree(p, room, { ...design, items: [...rest, ...items] }, ctx);
      if (spot) items.push(spot);
      else dropped.push({ name: p.name.split(',')[0], reason: 'No open spot left that keeps the walkways clear' });
    }
    const issues = issuesFor({ ...design, items: [...rest, ...items] }, ctx).filter((i) => items.some((x) => x.uid === i.uid));
    const stats = floorStats(room, items, ctx.products);
    const cost = issues.filter((i) => i.level === 'error').length * 1000 + issues.length * 50 + dropped.length * 200 - stats.freeShare * 100;
    if (!best || cost < best.cost) best = { items, dropped, cost };
  }
  const items = best!.items;
  return { design: { ...design, items: [...rest, ...items] }, placed: items.length, dropped: best!.dropped, stats: floorStats(room, items, ctx.products) };
}

// Same pieces, smaller footprints: swap each piece for the most compact product of the same kind
// that keeps the theme, then re-lay the room. For "make the room feel bigger".
export function compactRoom(room: Room, design: WorkDesign, ctx: Ctx) {
  const byId = byIdOf(ctx.products);
  const mine = design.items.filter((i) => i.roomId === room.id).map((i) => byId.get(i.productId)).filter((p): p is Product => !!p);
  const swaps: { from: string; to: string; savedM2: number }[] = [];
  const ids = mine.map((p) => {
    const area = (x: Product) => (x.dimsCm.w * x.dimsCm.d) / 1e4;
    const alt = ctx.products
      .filter((q) => q.category === p.category && q.placement === p.placement && area(q) < area(p) * 0.9)
      .filter((q) => !design.themeId || q.styles.includes(design.themeId) || p.styles.some((s) => q.styles.includes(s)))
      .sort((a, b) => area(a) - area(b))[0];
    if (!alt || p.category === 'rug') return p.id;
    swaps.push({ from: p.name.split(',')[0], to: alt.name.split(',')[0], savedM2: area(p) - area(alt) });
    return alt.id;
  });
  const before = floorStats(room, design.items, ctx.products);
  const res = optimizeRoom(room, ids, design, ctx);
  return { ...res, swaps, before };
}

// Furnish a room for a look and a budget, using the rule-based picker, then lay it out.
export function styleRoom(room: Room, theme: ThemeId | null, budget: number, design: WorkDesign, ctx: Ctx) {
  const picks = pickProducts(roomTypeOf(room.label), theme, budget, room, ctx.products);
  return optimizeRoom(room, picks.map((p) => p.product.id), { ...design, themeId: theme ?? design.themeId }, ctx);
}

// Swap one placed piece for a cheaper (or pricier, or other-style) product of the same kind that
// still fits where it stands. Returns the new design, or null when nothing better fits.
export function swapFor(design: WorkDesign, uid: string, want: 'cheaper' | 'premium' | ThemeId, ctx: Ctx) {
  const byId = byIdOf(ctx.products);
  const item = design.items.find((i) => i.uid === uid);
  const cur = item && byId.get(item.productId);
  if (!item || !cur) return null;
  const alts = alternatives({ item, items: design.items, products: ctx.products, rooms: ctx.geometry.rooms, doors: design.doors, walls: ctx.geometry.walls, theme: design.themeId, count: 40 }).filter((a) => a.fits);
  const pick =
    want === 'cheaper'
      ? alts.filter((a) => a.product.priceUsd < cur.priceUsd).sort((a, b) => b.product.priceUsd - a.product.priceUsd)[0] // the closest step down keeps the look
      : want === 'premium'
        ? alts.filter((a) => a.product.priceUsd > cur.priceUsd).sort((a, b) => a.product.priceUsd - b.product.priceUsd)[0]
        : alts.filter((a) => a.product.styles.includes(want)).sort((a, b) => Math.abs(a.product.priceUsd - cur.priceUsd) - Math.abs(b.product.priceUsd - cur.priceUsd))[0];
  if (!pick) return null;
  return { design: { ...design, items: design.items.map((i) => (i.uid === uid ? { ...pick.item, uid } : i)) }, from: cur, to: pick.product };
}

// Bring the furniture total under a target by stepping the priciest pieces down to cheaper ones
// that fit, then dropping optional accessories if that is not enough.
export function fitToBudget(design: WorkDesign, target: number, ctx: Ctx) {
  const byId = byIdOf(ctx.products);
  // Net change per piece (a sofa stepped down three times is reported once, first → last).
  const swaps = new Map<string, { from: Product; to: Product }>();
  const removed: string[] = [];
  let d = design;
  for (let guard = 0; guard < 40 && designTotal(d, ctx.products) > target; guard++) {
    const order = [...d.items].sort((a, b) => (byId.get(b.productId)?.priceUsd ?? 0) - (byId.get(a.productId)?.priceUsd ?? 0));
    let moved = false;
    for (const it of order) {
      const r = swapFor(d, it.uid, 'cheaper', ctx);
      if (!r) continue;
      d = r.design;
      swaps.set(it.uid, { from: swaps.get(it.uid)?.from ?? r.from, to: r.to });
      moved = true;
      break;
    }
    if (moved) continue;
    const optional = order.find((i) => ['plant', 'side-table', 'floor-lamp', 'armchair', 'bookshelf', 'mirror', 'wall-art', 'bench'].includes(byId.get(i.productId)?.category ?? ''));
    if (!optional) break;
    d = { ...d, items: d.items.filter((i) => i.uid !== optional.uid) };
    removed.push(`Removed ${(swaps.get(optional.uid)?.from ?? byId.get(optional.productId)!).name.split(',')[0]}`);
    swaps.delete(optional.uid);
  }
  const changes = [
    ...[...swaps.values()].map(({ from, to }) => `${from.name.split(',')[0]} → ${to.name.split(',')[0]} (−$${Math.round(from.priceUsd - to.priceUsd)})`),
    ...removed,
  ];
  return { design: d, changes, total: designTotal(d, ctx.products), met: designTotal(d, ctx.products) <= target };
}

export function designTotal(design: WorkDesign, products: Product[]): number {
  const byId = byIdOf(products);
  return design.items.reduce((s, i) => s + (byId.get(i.productId)?.priceUsd ?? 0), 0);
}
