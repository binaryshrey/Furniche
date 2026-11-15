import { centroid, convexSeparation, distPointSegment, pointInPolygon, rectCorners } from './geometry';
import type { Category, Product, Room, Vec2, Wall } from './types';

// Staging a room the way a stager would: a complete, coordinated set (bedroom: bed with mattress,
// nightstands, a big painting over the bed, lamp, dressing table with a mirror, closet, TV, vase;
// living room: sofa set, coffee table, rug, TV on its unit, a big painting over the sofa, dining
// table with chairs, vase, lamp, plant). Every piece:
//   - backs onto a real wall and never covers a window or a doorway (windows and doorways come
//     from Matterport's floor plan, with the scan's guesses as a fallback)
//   - never overlaps another piece (a mattress on its bed and chairs at their table aside)
//   - leaves room to walk in front of every doorway
// and the set is drawn from one colour family so the room reads as designed.
// Wall pieces (art, mirrors, the TV) carry their hanging height in pos.z.

export type Span = { a: Vec2; b: Vec2; sill?: number; head?: number };
export type RoomOpenings = { windows: Span[]; doors: Span[]; builtins?: Span[] }; // builtins: fireplace, columns…
export type Staged = { productId: string; roomId: string; pos: { x: number; y: number; z: number }; rot: number; role: string };
export type StageResult = { placed: Staged[]; missing: string[] };

const WALL_GAP = 0.11; // outline runs mid-wall: half a wall plus a little air
const HANG_GAP = 0.07; // a frame's back against the wall surface
const DOOR_CLEAR = 0.9; // walking room in front of a doorway

const faceRot = (n: Vec2) => Math.atan2(n.x, -n.y);
const add = (p: Vec2, v: Vec2, s: number): Vec2 => ({ x: p.x + v.x * s, y: p.y + v.y * s });
const W = (p: Product) => p.dimsCm.w / 100;
const D = (p: Product) => p.dimsCm.d / 100;
const H = (p: Product) => p.dimsCm.h / 100;

// Windows and doorways on this room's walls, from the floor plan's wall openings.
export function openingsFor(room: Room, walls: Wall[]): RoomOpenings {
  const out: RoomOpenings = { windows: [], doors: [] };
  const edges = room.polygon.map((p, i) => [p, room.polygon[(i + 1) % room.polygon.length]] as const);
  for (const w of walls) {
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (len < 0.3) continue;
    const t = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
    for (const o of w.openings ?? []) {
      const c = { x: w.a.x + (w.b.x - w.a.x) * o.at, y: w.a.y + (w.b.y - w.a.y) * o.at };
      if (!edges.some(([a, b]) => distPointSegment(c, a, b) < 0.2)) continue;
      const half = Math.min(o.width, len) / 2;
      const span = { a: add(c, t, -half), b: add(c, t, half), sill: o.sill, head: o.sill + o.height };
      (o.type === 'window' ? out.windows : out.doors).push(span);
    }
  }
  return out;
}

type Side = { a: Vec2; b: Vec2; len: number; t: Vec2; n: Vec2; mid: Vec2 };

function sides(room: Room): Side[] {
  const poly = room.polygon;
  const out: Side[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.6) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let n = { x: -t.y, y: t.x };
    if (!pointInPolygon(add(mid, n, 0.15), poly)) n = { x: t.y, y: -t.x };
    out.push({ a, b, len, t, n, mid });
  }
  return out;
}

// Where a span lies along a side, as [from, to] in metres from side.a; null if it isn't on it.
function along(side: Side, s: Span): [number, number] | null {
  const off = (p: Vec2) => Math.abs((p.x - side.a.x) * side.n.x + (p.y - side.a.y) * side.n.y);
  if (off(s.a) > 0.25 || off(s.b) > 0.25) return null;
  const u = (p: Vec2) => (p.x - side.a.x) * side.t.x + (p.y - side.a.y) * side.t.y;
  const [p, q] = [u(s.a), u(s.b)].sort((x, y) => x - y);
  if (q < 0 || p > side.len) return null;
  return [p, q];
}

function colorDist(a: string, b: string): number {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const [x, y] = [rgb(a), rgb(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 441;
}

const realModel = (p: Product) => p.retailer === 'ikea' && /^https:\/\/www\.ikea\.com\//.test(p.url);

type Box = { fp: Vec2[]; cat: Category; h: number };

class Planner {
  placed: Staged[] = [];
  boxes: Box[] = [];
  hung: { side: Side; from: number; to: number; lo: number; hi: number }[] = [];
  missing: string[] = [];
  hasCloset = false; // the room already has one (a closet off it, or a built-in)
  readonly sides: Side[];
  readonly ceiling: number;
  readonly c: Vec2;
  constructor(
    readonly room: Room,
    readonly products: Product[],
    readonly open: RoomOpenings,
    public fixtures: Vec2[][],
    readonly palette: string,
  ) {
    this.sides = sides(room);
    // A built-out piece that reaches the floor (a fireplace hearth, a column) is a fixture too.
    for (const bi of open.builtins ?? []) {
      if ((bi.sill ?? 0) > 0.5) continue;
      const side = this.sides.find((x) => along(x, bi));
      if (!side) continue;
      const m = { x: (bi.a.x + bi.b.x) / 2, y: (bi.a.y + bi.b.y) / 2 };
      const w = Math.hypot(bi.b.x - bi.a.x, bi.b.y - bi.a.y);
      this.fixtures = [...this.fixtures, rectCorners(add(m, side.n, 0.3), w + 0.1, 0.6, faceRot(side.n))];
    }
    this.ceiling = room.heightM ?? 2.5;
    this.c = centroid(room.polygon);
  }

  // Best product for a role: right kind, fits the wall/room, closest to the colour family.
  pick(cats: Category[], o: { maxW?: number; maxD?: number; maxH?: number; minW?: number; prefer?: (p: Product) => number; placement?: 'floor' | 'wall' } = {}): Product | null {
    const pool = this.products
      .filter((p) => cats.includes(p.category) && p.placement !== 'outdoor' && (!o.placement || p.placement === o.placement))
      .filter((p) => W(p) <= (o.maxW ?? 99) && D(p) <= (o.maxD ?? 99) && H(p) <= Math.min(o.maxH ?? 99, this.ceiling - 0.08) && W(p) >= (o.minW ?? 0))
      .map((p) => ({ p, s: -3 * colorDist(p.color, this.palette) + (realModel(p) ? 1.5 : 0) + (o.prefer?.(p) ?? 0) - cats.indexOf(p.category) * 0.2 }))
      .sort((a, b) => b.s - a.s);
    return pool[0]?.p ?? null;
  }

  private fpOf(p: Product, pos: Vec2, rot: number) {
    return rectCorners(pos, W(p), D(p), rot);
  }

  // A floor piece at pos/rot is allowed: inside the room, clear of other pieces (unless allowed),
  // fixtures, doorways and windows.
  ok(p: Product, pos: Vec2, rot: number, allow: Category[] = []): boolean {
    const fp = this.fpOf(p, pos, rot);
    if (fp.some((c) => !pointInPolygon(c, this.room.polygon))) return false;
    const rug = p.category === 'rug';
    if (!rug) {
      for (const b of this.boxes) {
        if (b.cat === 'rug' || allow.includes(b.cat)) continue;
        if (convexSeparation(fp, b.fp) < 0.06) return false;
      }
      if (this.fixtures.some((f) => convexSeparation(fp, f) < 0.02)) return false;
    }
    for (const d of this.open.doors) {
      const dm = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
      const dw = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      // Keep a clear rectangle in front of the doorway, on this room's side.
      const s = this.sides.find((x) => along(x, d));
      const n = s?.n ?? { x: this.c.x - dm.x, y: this.c.y - dm.y };
      const nl = Math.hypot(n.x, n.y) || 1;
      const nn = { x: n.x / nl, y: n.y / nl };
      const zone = rectCorners(add(dm, nn, DOOR_CLEAR / 2), dw + 0.2, DOOR_CLEAR, faceRot(nn));
      if (convexSeparation(fp, zone) < (rug ? -0.6 : 0)) return false;
    }
    if (!rug) {
      for (const w of this.open.windows) {
        const sill = w.sill ?? 0.8;
        if (H(p) <= sill - 0.05) continue; // low enough to sit under the sill
        // Nothing taller than the sill within 40 cm of the glass, anywhere along it.
        for (let k = 0; k <= 8; k++) {
          const q = { x: w.a.x + ((w.b.x - w.a.x) * k) / 8, y: w.a.y + ((w.b.y - w.a.y) * k) / 8 };
          if (pointInPolygon(q, fp) || fp.some((c, i) => distPointSegment(q, c, fp[(i + 1) % fp.length]) < 0.4)) return false;
        }
      }
    }
    return true;
  }

  put(role: string, p: Product, pos: Vec2, rot: number, z = this.room.floorZ) {
    this.placed.push({ role, productId: p.id, roomId: this.room.id, pos: { x: pos.x, y: pos.y, z }, rot });
    if (p.placement !== 'wall' && p.category !== 'mattress') this.boxes.push({ fp: this.fpOf(p, pos, rot), cat: p.category, h: H(p) });
  }

  // Free stretches of a side for something `w` wide: not across a doorway, and (for tall things
  // or wall pieces between lo and hi) not across a window. Returns candidate offsets along the side.
  slots(side: Side, w: number, lo: number, hi: number): number[] {
    const blocked: [number, number][] = [];
    for (const d of this.open.doors) {
      const r = along(side, d);
      if (r) blocked.push([r[0] - 0.15, r[1] + 0.15]);
    }
    for (const win of this.open.windows) {
      const r = along(side, win);
      if (r && hi > (win.sill ?? 0.8) - 0.05 && lo < (win.head ?? 2.1) + 0.05) blocked.push([r[0] - 0.12, r[1] + 0.12]);
    }
    for (const bi of this.open.builtins ?? []) {
      const r = along(side, bi);
      if (r && hi > (bi.sill ?? 0) - 0.05 && lo < (bi.head ?? 2.5) + 0.05) blocked.push([r[0] - 0.1, r[1] + 0.1]);
    }
    // Furniture standing against this wall (a closet, a dresser) up to the height it reaches.
    for (const b of this.boxes) {
      if (b.cat === 'rug') continue;
      const near = Math.min(...b.fp.map((c) => Math.abs((c.x - side.a.x) * side.n.x + (c.y - side.a.y) * side.n.y)));
      if (near > 0.9 || lo > b.h + 0.05) continue;
      const us = b.fp.map((c) => (c.x - side.a.x) * side.t.x + (c.y - side.a.y) * side.t.y);
      blocked.push([Math.min(...us) - 0.08, Math.max(...us) + 0.08]);
    }
    for (const h of this.hung) if (h.side === side && hi > h.lo - 0.05 && lo < h.hi + 0.05) blocked.push([h.from - 0.1, h.to + 0.1]);
    const out: number[] = [];
    for (let s = w / 2 + 0.05; s <= side.len - w / 2 - 0.05; s += 0.05) {
      if (!blocked.some(([p, q]) => s + w / 2 > p && s - w / 2 < q)) out.push(s);
    }
    return out;
  }

  // Back a floor piece onto the best side (score), trying spots from the preferred one outward.
  againstWall(role: string, p: Product, score: (side: Side, s: number) => number, sidesToTry = this.sides, allow: Category[] = []): { side: Side; s: number; pos: Vec2; rot: number } | null {
    let best: { side: Side; s: number; pos: Vec2; rot: number; v: number } | null = null;
    for (const side of sidesToTry) {
      for (const s of this.slots(side, W(p), 0, H(p))) {
        const pos = add(add(side.a, side.t, s), side.n, D(p) / 2 + WALL_GAP);
        const rot = faceRot(side.n);
        if (!this.ok(p, pos, rot, allow)) continue;
        const v = score(side, s);
        if (!best || v > best.v) best = { side, s, pos, rot, v };
      }
    }
    if (!best) return null;
    this.put(role, p, best.pos, best.rot);
    return best;
  }

  // Hang a wall piece centred at offset s along a side, its bottom `bottom` m above the floor.
  hang(role: string, p: Product, side: Side, s: number, bottom: number, maxShift = 0.6): boolean {
    const w = W(p);
    const top = bottom + H(p);
    if (top > this.ceiling - 0.05) bottom = Math.max(0.3, this.ceiling - 0.05 - H(p));
    const free = this.slots(side, w, bottom, bottom + H(p));
    if (!free.length) return false;
    const at = free.reduce((x, y) => (Math.abs(y - s) < Math.abs(x - s) ? y : x));
    if (Math.abs(at - s) > maxShift) return false;
    const pos = add(add(side.a, side.t, at), side.n, D(p) / 2 + HANG_GAP);
    this.put(role, p, pos, faceRot(side.n), this.room.floorZ + bottom);
    this.hung.push({ side, from: at - w / 2, to: at + w / 2, lo: bottom, hi: bottom + H(p) });
    return true;
  }

  // The biggest TV that suits the empty stretch of wall around s: no wider than ~60% of it, never
  // across a window, a doorway, a closet or a painting.
  hangTv(side: Side, s: number, bottom: number, maxShift = side.len): boolean {
    // And no bigger than suits how far away you sit: about 0.42 x the room's depth from that wall.
    const view = Math.max(...this.room.polygon.map((p) => (p.x - side.a.x) * side.n.x + (p.y - side.a.y) * side.n.y));
    const tvs = this.products.filter((p) => p.category === 'tv').sort((a, b) => W(b) - W(a));
    for (const tv of tvs) {
      if (W(tv) > view * 0.42 && tv !== tvs[tvs.length - 1]) continue;
      const free = this.slots(side, W(tv), bottom, bottom + H(tv));
      if (!free.length) continue;
      const at = free.reduce((x, y) => (Math.abs(y - s) < Math.abs(x - s) ? y : x));
      // How long the empty stretch around that spot is.
      let lo = at;
      let hi = at;
      while (free.some((x) => Math.abs(x - (lo - 0.05)) < 0.026)) lo -= 0.05;
      while (free.some((x) => Math.abs(x - (hi + 0.05)) < 0.026)) hi += 0.05;
      const run = hi - lo + W(tv);
      if (W(tv) > run * 0.62 && tv !== tvs[tvs.length - 1]) continue;
      if (this.hang('tv', tv, side, s, bottom, maxShift)) return true;
    }
    return false;
  }

  // A small piece in the free corner farthest from the room's busy middle.
  corner(role: string, p: Product): boolean {
    const spots = this.room.polygon
      .map((v) => {
        const dir = { x: this.c.x - v.x, y: this.c.y - v.y };
        const l = Math.hypot(dir.x, dir.y) || 1;
        return add(v, { x: dir.x / l, y: dir.y / l }, Math.max(W(p), D(p)) * 0.75 + 0.18);
      })
      .sort((a, b) => Math.hypot(b.x - this.c.x, b.y - this.c.y) - Math.hypot(a.x - this.c.x, a.y - this.c.y));
    for (const s of spots) {
      if (this.ok(p, s, 0)) {
        this.put(role, p, s, 0);
        return true;
      }
    }
    return false;
  }

  need(label: string, done: boolean | null | undefined) {
    if (!done) this.missing.push(label);
  }
}

// Pieces that hang: art over the anchor, centred, bottom ~25 cm above it.
function artOver(pl: Planner, side: Side, s: number, anchorW: number, anchorTop: number, role = 'wall art') {
  const art = pl.pick(['wall-art'], { maxW: Math.min(side.len - 0.3, Math.max(anchorW * 0.95, 0.9)), placement: 'wall', prefer: (p) => W(p) * 1.4 }); // as big as fits
  if (!art) return false;
  const bottom = Math.max(anchorTop + 0.25, 1.05);
  return pl.hang(role, art, side, s, bottom);
}

function stageBedroom(pl: Planner): void {
  const longest = Math.max(pl.room.widthM, pl.room.depthM);
  const shortest = Math.min(pl.room.widthM, pl.room.depthM);
  const bedMax = { maxW: longest - 0.6, maxD: shortest - 0.75 };
  const bed = pl.pick(['bed'], { ...bedMax, prefer: (p) => (W(p) >= 1.5 ? 0.6 : 0) });
  if (!bed) return pl.need('bed', false);
  // Headboard on the longest free wall, centred; the bed needs walking room on both long sides.
  const headSides = [...pl.sides].sort((a, b) => b.len - a.len);
  const placedBed = pl.againstWall('bed', bed, (side, s) => side.len * 2 - Math.abs(s - side.len / 2) * 1.5, headSides);
  if (!placedBed) return pl.need('bed', false);
  const { side: head, s: hs, pos: bp, rot } = placedBed;

  const mattress = pl.pick(['mattress'], { maxW: W(bed) + 0.05 });
  if (mattress && !/mattress/i.test(bed.name)) pl.put('mattress', mattress, bp, rot);

  // Nightstands either side of the headboard.
  const ns = pl.pick(['nightstand'], { maxW: 0.55 });
  let nightstands = 0;
  if (ns) {
    for (const sgn of [-1, 1]) {
      const s = hs + sgn * (W(bed) / 2 + W(ns) / 2 + 0.06);
      const pos = add(add(head.a, head.t, s), head.n, D(ns) / 2 + WALL_GAP);
      if (s - W(ns) / 2 > 0.05 && s + W(ns) / 2 < head.len - 0.05 && pl.ok(ns, pos, rot)) {
        pl.put('nightstand', ns, pos, rot);
        nightstands++;
      }
    }
  }
  pl.need('nightstand', nightstands > 0);

  // The big painting over the bed.
  pl.need('painting over the bed', artOver(pl, head, hs, W(bed), Math.max(H(bed), 1.0) - 0.05));

  // A big floor lamp by a nightstand (or the bed).
  const lamp = pl.pick(['floor-lamp'], { prefer: (p) => H(p) * 0.8 });
  if (lamp) {
    let ok = false;
    for (const sgn of [1, -1]) {
      const s = hs + sgn * (W(bed) / 2 + (nightstands ? W(ns!) + 0.12 : 0.06) + W(lamp) / 2);
      const pos = add(add(head.a, head.t, s), head.n, D(lamp) / 2 + WALL_GAP + 0.05);
      if (s > 0.2 && s < head.len - 0.2 && pl.ok(lamp, pos, 0)) {
        pl.put('floor lamp', lamp, pos, rot);
        ok = true;
        break;
      }
    }
    if (!ok) ok = pl.corner('floor lamp', lamp);
    pl.need('floor lamp', ok);
  }

  const others = pl.sides.filter((x) => x !== head);
  const facingBed = (side: Side) => -(side.n.x * head.n.x + side.n.y * head.n.y); // 1 = opposite wall

  // TV on the wall facing the bed, at eye height from bed.
  let tvSide: Side | null = null;
  {
    const cands = [...others].sort((a, b) => facingBed(b) - facingBed(a));
    for (const side of cands) {
      if (facingBed(side) < -0.3) break; // never behind the bed
      const u = (bp.x - side.a.x) * side.t.x + (bp.y - side.a.y) * side.t.y;
      if (pl.hangTv(side, Math.max(0.6, Math.min(side.len - 0.6, u)), 1.0)) {
        tvSide = side;
        break;
      }
    }
    pl.need('TV', !!tvSide);
  }

  // Closet: the tallest piece, on a side wall, ideally in a corner.
  const closet = pl.hasCloset ? null : pl.pick(['wardrobe'], { maxW: Math.max(...others.map((x) => x.len)) - 0.2, maxD: shortest - 1.6 - D(bed) > 0 ? 0.65 : 0.62 });
  if (closet) {
    const placed = pl.againstWall('closet', closet, (side, s) => (side === tvSide ? -5 : 0) + Math.abs(facingBed(side)) * -1 + Math.max(s, side.len - s) * 0.4 + side.len * 0.2, others);
    pl.need('closet', !!placed);
  }

  // Dressing table with a mirror over it.
  const dresser = pl.pick(['dresser'], { maxH: 1.0, maxD: 0.55, prefer: (p) => (W(p) <= 1.45 ? 0.5 : 0) });
  if (dresser) {
    const placed = pl.againstWall('dressing table', dresser, (side, s) => (side === tvSide ? -2 : 0) - Math.abs(s - side.len / 2) * 0.3 + side.len * 0.1, others);
    pl.need('dressing table', !!placed);
    if (placed) {
      const mirror = pl.pick(['mirror'], { maxW: W(dresser) * 0.9, maxH: pl.ceiling - H(dresser) - 0.35, placement: 'wall', prefer: (p) => H(p) * 0.5 });
      pl.need('mirror', !!mirror && pl.hang('mirror', mirror, placed.side, placed.s, H(dresser) + 0.15));
    }
  }

  // A vase in a free corner, a rug at the foot of the bed.
  const vase = pl.pick(['decor'], { prefer: (p) => (/vase/i.test(p.name) ? 3 : 0) });
  if (vase) pl.need('flower vase', pl.corner('flower vase', vase));
  const rug = pl.pick(['rug'], { maxW: Math.min(W(bed) + 0.9, longest - 0.5) });
  if (rug) {
    const pos = add(bp, head.n, D(bed) * 0.22);
    const rr = rot + (W(rug) > D(rug) ? 0 : Math.PI / 2);
    if (pl.ok(rug, pos, rr)) pl.put('rug', rug, pos, rr);
  }
}

function stageLiving(pl: Planner): void {
  const longest = Math.max(pl.room.widthM, pl.room.depthM);
  const shortest = Math.min(pl.room.widthM, pl.room.depthM);
  const sofa = pl.pick(['sofa', 'sectional'], { maxW: longest - 0.8, maxD: shortest - 2.2, prefer: (p) => W(p) * 0.4 });
  if (!sofa) return pl.need('sofa', false);
  const sides = [...pl.sides].sort((a, b) => b.len - a.len);
  const s1 = pl.againstWall('sofa', sofa, (side, s) => side.len * 2 - Math.abs(s - side.len / 2) * 1.2, sides);
  if (!s1) return pl.need('sofa', false);
  const { side: back, s: bs, pos: sp, rot } = s1;

  // Art over the sofa.
  pl.need('wall painting', artOver(pl, back, bs, W(sofa), H(sofa)));

  // Coffee table and rug in front.
  const ct = pl.pick(['coffee-table'], { maxW: W(sofa) * 0.7 });
  let ctPos = add(sp, back.n, D(sofa) / 2 + 0.45 + (ct ? D(ct) / 2 : 0.3));
  const rug = pl.pick(['rug'], { maxW: W(sofa) + 0.8, prefer: (p) => W(p) * 0.5 });
  if (rug) {
    const rp = add(sp, back.n, D(sofa) / 2 + (W(rug) > D(rug) ? D(rug) : W(rug)) / 2 - 0.15);
    const rr = rot + (W(rug) >= D(rug) ? 0 : Math.PI / 2);
    if (pl.ok(rug, rp, rr)) pl.put('rug', rug, rp, rr);
  }
  if (ct) {
    if (pl.ok(ct, ctPos, rot)) pl.put('coffee table', ct, ctPos, rot);
    else ctPos = sp;
  }

  // TV unit on the opposite wall, the TV over it.
  const opp = pl.sides.filter((x) => x.n.x * back.n.x + x.n.y * back.n.y < -0.7).sort((a, b) => b.len - a.len);
  const unit = pl.pick(['tv-console'], { maxW: 1.85 });
  const tv = pl.pick(['tv'], { placement: 'wall', maxW: 1.25 }); // to fit the unit; resized when hung
  let tvDone = false;
  if (unit) {
    const u = (side: Side) => (sp.x - side.a.x) * side.t.x + (sp.y - side.a.y) * side.t.y;
    // Only where the TV can hang above it (not under a window or by a fireplace).
    const tvFits = (side: Side, s: number) => !tv || pl.slots(side, W(tv), H(unit) + 0.25, H(unit) + 0.25 + H(tv)).some((x) => Math.abs(x - s) < 0.05);
    const unitSides = [...opp, ...pl.sides.filter((x) => x !== back && !opp.includes(x))];
    const placed = pl.againstWall('tv unit', unit, (side, s) => (tvFits(side, s) ? 0 : -100) + (opp.includes(side) ? 5 : 0) - Math.abs(s - u(side)), unitSides);
    if (placed && tv) tvDone = pl.hangTv(placed.side, placed.s, H(unit) + 0.25, 0.3);
    pl.need('TV unit', !!placed);
  }
  if (tv && !tvDone) {
    for (const side of [...opp, ...pl.sides.filter((x) => x !== back)]) if ((tvDone = pl.hangTv(side, side.len / 2, 1.0))) break;
  }
  pl.need('TV', tvDone);

  // Armchair beside the coffee table, a side table and a lamp by the sofa.
  const chair = pl.pick(['armchair']);
  if (chair) {
    for (const sgn of [1, -1]) {
      const pos = add(ctPos, back.t, sgn * ((ct ? W(ct) / 2 : 0.5) + 0.35 + D(chair) / 2));
      const r = faceRot({ x: -back.t.x * sgn, y: -back.t.y * sgn });
      if (pl.ok(chair, pos, r)) {
        pl.put('armchair', chair, pos, r);
        break;
      }
    }
  }
  const lamp = pl.pick(['floor-lamp'], { prefer: (p) => H(p) * 0.8 });
  const side = pl.pick(['side-table']);
  for (const [role, p] of [['side table', side], ['floor lamp', lamp]] as const) {
    if (!p) continue;
    let ok = false;
    for (const sgn of [-1, 1]) {
      const s = bs + sgn * (W(sofa) / 2 + W(p) / 2 + 0.08);
      const pos = add(add(back.a, back.t, s), back.n, D(p) / 2 + WALL_GAP + 0.04);
      if (s > 0.15 && s < back.len - 0.15 && pl.ok(p, pos, rot)) {
        pl.put(role, p, pos, rot);
        ok = true;
        break;
      }
    }
    if (!ok && role === 'floor lamp') ok = pl.corner(role, p);
    if (role === 'floor lamp') pl.need('floor lamp', ok);
  }

  // Dining table with chairs, in the most open stretch left.
  const table = pl.pick(['dining-table', 'round-table'], { maxW: 1.45, prefer: (p) => (W(p) <= 1.45 ? 0.5 : 0) });
  const chairP = pl.pick(['dining-chair']);
  if (table) {
    const xs = pl.room.polygon.map((p) => p.x);
    const ys = pl.room.polygon.map((p) => p.y);
    let best: { pos: Vec2; rot: number; v: number } | null = null;
    // Table plus its chairs pulled out need a clear rectangle.
    const ghost: Product = { ...table, dimsCm: { w: table.dimsCm.w + 50, d: table.dimsCm.d + 110, h: table.dimsCm.h } };
    for (let x = Math.min(...xs) + 0.6; x < Math.max(...xs) - 0.6; x += 0.15) {
      for (let y = Math.min(...ys) + 0.6; y < Math.max(...ys) - 0.6; y += 0.15) {
        for (const r of [rot, rot + Math.PI / 2]) {
          const pos = { x, y };
          if (!pl.ok(ghost, pos, r)) continue;
          const v = Math.hypot(x - sp.x, y - sp.y); // away from the sofa
          if (!best || v > best.v) best = { pos, rot: r, v };
        }
      }
    }
    if (best) {
      pl.put('dining table', table, best.pos, best.rot);
      if (chairP) {
        const cos = Math.cos(best.rot);
        const sin = Math.sin(best.rot);
        const local = (lx: number, ly: number): Vec2 => ({ x: best!.pos.x + lx * cos - ly * sin, y: best!.pos.y + lx * sin + ly * cos });
        const offs = W(table) >= 1.3 ? [-W(table) / 4, W(table) / 4] : [0];
        for (const ox of offs) {
          for (const sgn of [-1, 1]) {
            const p = local(ox, sgn * (D(table) / 2 + 0.25));
            const face = { x: best.pos.x - p.x, y: best.pos.y - p.y };
            const l = Math.hypot(face.x, face.y) || 1;
            const r = faceRot({ x: face.x / l, y: face.y / l });
            if (pl.ok(chairP, p, r, ['dining-table', 'round-table'])) pl.put('dining chair', chairP, p, r);
          }
        }
      }
    }
    pl.need('dining table', !!best);
  }

  // Vase and plant in free corners.
  const vase = pl.pick(['decor'], { prefer: (p) => (/vase/i.test(p.name) ? 3 : 0) });
  if (vase) pl.need('flower vase', pl.corner('flower vase', vase));
  const plant = pl.pick(['plant']);
  if (plant) pl.corner('plant', plant);
}

export function stageRoom(
  room: Room,
  kind: 'bedroom' | 'living',
  products: Product[],
  open: RoomOpenings,
  fixtures: Vec2[][] = [],
  palette = '#e9e2d4', // warm white and light oak
  opts: { hasCloset?: boolean } = {},
): StageResult {
  const pl = new Planner(room, products, open, fixtures, palette);
  pl.hasCloset = !!opts.hasCloset || (open.builtins ?? []).some((b) => (b.sill ?? 0) < 0.5 && (b.head ?? 0) > 1.8 && Math.hypot(b.b.x - b.a.x, b.b.y - b.a.y) >= 0.8);
  if (kind === 'bedroom') stageBedroom(pl);
  else stageLiving(pl);
  return { placed: pl.placed, missing: pl.missing };
}

// Where a wall piece goes when it is dropped or dragged near point p: flat against the nearest wall
// of the room, centred on p along it, facing into the room. Keeps its height, or a sensible one.
export function hangAt(p: Vec2, product: Product, room: Room, z?: number): { pos: { x: number; y: number; z: number }; rot: number } {
  let best: { side: Side; u: number; d: number } | null = null;
  for (const side of sides(room)) {
    const u = (p.x - side.a.x) * side.t.x + (p.y - side.a.y) * side.t.y;
    const cu = Math.max(W(product) / 2, Math.min(side.len - W(product) / 2, u));
    const q = add(side.a, side.t, cu);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || d < best.d) best = { side, u: cu, d };
  }
  const ceiling = room.heightM ?? 2.5;
  const defaultBottom = product.category === 'tv' ? 1.0 : product.category === 'mirror' ? Math.max(0.3, Math.min(1.0, ceiling - 0.15 - H(product))) : 1.2;
  const bottom = z !== undefined && z - room.floorZ > 0.25 ? z - room.floorZ : defaultBottom;
  const zz = room.floorZ + Math.min(bottom, Math.max(0.1, ceiling - 0.05 - H(product)));
  if (!best) return { pos: { x: p.x, y: p.y, z: zz }, rot: 0 };
  const pos = add(add(best.side.a, best.side.t, best.u), best.side.n, D(product) / 2 + HANG_GAP);
  return { pos: { x: pos.x, y: pos.y, z: zz }, rot: faceRot(best.side.n) };
}

// Whether a room already has a closet: a closet / wardrobe / walk-in room right next to it.
export function closetNextTo(room: Room, rooms: Room[]): boolean {
  const edges = (r: Room) => r.polygon.map((p, i) => [p, r.polygon[(i + 1) % r.polygon.length]] as const);
  return rooms.some(
    (r) =>
      r.id !== room.id &&
      r.floorId === room.floorId &&
      /closet|wardrobe|walk-?in|wic\b/i.test(r.label) &&
      r.polygon.some((p) => edges(room).some(([a, b]) => distPointSegment(p, a, b) < 0.35)),
  );
}
