import { centroid, pointInPolygon } from './geometry';
import { checkFit } from './fit';
import type { Category, DoorMark, PlacedItem, Product, Room, ThemeId, Vec2 } from './types';

export type RoomType = 'living' | 'bedroom' | 'dining' | 'office';

export function roomTypeOf(label: string): RoomType {
  if (/bed/i.test(label)) return 'bedroom';
  if (/dining/i.test(label)) return 'dining';
  if (/office|study|den/i.test(label)) return 'office';
  return 'living';
}

// Roles a room is furnished with, in priority order. `alts` are categories that can fill the role.
export type Role = { role: string; alts: Category[]; count?: number; weight: number; optional?: boolean };

export const TEMPLATES: Record<RoomType, Role[]> = {
  living: [
    { role: 'sofa', alts: ['sofa', 'sectional'], weight: 0.38 },
    { role: 'coffee table', alts: ['coffee-table'], weight: 0.1 },
    { role: 'rug', alts: ['rug'], weight: 0.1 },
    { role: 'tv console', alts: ['tv-console'], weight: 0.12 },
    { role: 'armchair', alts: ['armchair'], weight: 0.14, optional: true },
    { role: 'side table', alts: ['side-table'], weight: 0.03, optional: true },
    { role: 'floor lamp', alts: ['floor-lamp'], weight: 0.04, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.04, optional: true },
    { role: 'shelf', alts: ['bookshelf'], weight: 0.05, optional: true },
  ],
  bedroom: [
    { role: 'bed', alts: ['bed'], weight: 0.45 },
    { role: 'nightstand', alts: ['nightstand'], count: 2, weight: 0.12 },
    { role: 'dresser', alts: ['dresser'], weight: 0.2, optional: true },
    { role: 'rug', alts: ['rug'], weight: 0.1, optional: true },
    { role: 'floor lamp', alts: ['floor-lamp'], weight: 0.05, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.04, optional: true },
  ],
  dining: [
    { role: 'dining table', alts: ['dining-table', 'round-table'], weight: 0.45 },
    { role: 'dining chair', alts: ['dining-chair'], count: 4, weight: 0.35 },
    { role: 'rug', alts: ['rug'], weight: 0.1, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.05, optional: true },
  ],
  office: [
    { role: 'desk', alts: ['desk'], weight: 0.4 },
    { role: 'office chair', alts: ['office-chair'], weight: 0.3 },
    { role: 'shelf', alts: ['bookshelf'], weight: 0.15, optional: true },
    { role: 'floor lamp', alts: ['floor-lamp'], weight: 0.07, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.05, optional: true },
  ],
};

type Wall = { a: Vec2; b: Vec2; len: number; mid: Vec2; t: Vec2; n: Vec2; doorPenalty: number };

function roomWalls(room: Room, doors: DoorMark[]): Wall[] {
  const poly = room.polygon;
  const out: Wall[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.4) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let n = { x: -t.y, y: t.x };
    if (!pointInPolygon({ x: mid.x + n.x * 0.15, y: mid.y + n.y * 0.15 }, poly)) n = { x: t.y, y: -t.x };
    const doorPenalty = doors.filter((d) => d.roomId === room.id && distToSeg(d.pos, a, b) < 0.3).length;
    out.push({ a, b, len, mid, t, n, doorPenalty });
  }
  return out;
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Rotation that makes an item's front (API local -y at rot 0) face direction n.
const faceRot = (n: Vec2) => Math.atan2(n.x, -n.y);
const add = (p: Vec2, v: Vec2, s: number): Vec2 => ({ x: p.x + v.x * s, y: p.y + v.y * s });
const m = (p: Product) => ({ w: p.dimsCm.w / 100, d: p.dimsCm.d / 100 });

export type SolveInput = { room: Room; doors: DoorMark[]; picks: { role: string; product: Product }[] };
export type Placement = Omit<PlacedItem, 'uid'> & { role: string };

export function solveLayout({ room, doors, picks }: SolveInput): { placed: Placement[]; dropped: { role: string; product: Product; reason: string }[] } {
  const type = roomTypeOf(room.label);
  const walls = roomWalls(room, doors).sort((x, y) => y.len - x.len);
  const z = room.floorZ;
  const c = centroid(room.polygon);
  const placed: Placement[] = [];
  const get = (role: string) => picks.filter((p) => p.role === role).map((p) => p.product);
  const put = (role: string, product: Product, pos: Vec2, rot: number) =>
    placed.push({ role, productId: product.id, roomId: room.id, pos: { x: pos.x, y: pos.y, z }, rot });
  const freeWall = (exclude: Wall[] = []) =>
    walls.filter((w) => !exclude.includes(w)).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len)[0];
  const opposite = (w: Wall) =>
    walls.filter((o) => o !== w && o.n.x * w.n.x + o.n.y * w.n.y < -0.7).sort((x, y) => y.len - x.len)[0];
  const side = (w: Wall, exclude: Wall[]) =>
    walls.filter((o) => !exclude.includes(o) && Math.abs(o.n.x * w.n.x + o.n.y * w.n.y) < 0.3).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len)[0];
  const corner = (awayFrom: Vec2) => {
    const v = [...room.polygon].sort((p, q) => Math.hypot(q.x - awayFrom.x, q.y - awayFrom.y) - Math.hypot(p.x - awayFrom.x, p.y - awayFrom.y))[0];
    const dir = { x: c.x - v.x, y: c.y - v.y };
    const l = Math.hypot(dir.x, dir.y) || 1;
    return add(v, { x: dir.x / l, y: dir.y / l }, 0.45);
  };

  if (type === 'living') {
    const back = freeWall();
    const sofa = get('sofa')[0];
    if (back && sofa) {
      const s = m(sofa);
      const sp = add(back.mid, back.n, s.d / 2 + 0.03);
      const rot = faceRot(back.n);
      put('sofa', sofa, sp, rot);
      const ct = get('coffee table')[0];
      const ctPos = add(sp, back.n, s.d / 2 + 0.42 + (ct ? m(ct).d / 2 : 0.3));
      if (ct) put('coffee table', ct, ctPos, rot);
      const rug = get('rug')[0];
      if (rug) put('rug', rug, add(sp, back.n, s.d / 2 + 0.25), faceRot(back.n) + (m(rug).w < m(rug).d ? Math.PI / 2 : 0));
      const tvWall = opposite(back);
      const tv = get('tv console')[0];
      if (tv && tvWall) {
        const along = (sp.x - tvWall.a.x) * tvWall.t.x + (sp.y - tvWall.a.y) * tvWall.t.y;
        const clamp = Math.max(m(tv).w / 2 + 0.1, Math.min(tvWall.len - m(tv).w / 2 - 0.1, along));
        const base = add(tvWall.a, tvWall.t, clamp);
        put('tv console', tv, add(base, tvWall.n, m(tv).d / 2 + 0.03), faceRot(tvWall.n));
      }
      const chair = get('armchair')[0];
      if (chair) {
        const t = back.t;
        const reach = (ct ? m(ct).w / 2 : 0.5) + 0.35 + m(chair).d / 2;
        put('armchair', chair, add(ctPos, t, reach), faceRot({ x: -t.x, y: -t.y }));
      }
      const st = get('side table')[0];
      if (st) put('side table', st, add(sp, back.t, -(s.w / 2 + m(st).w / 2 + 0.05)), rot);
      const lamp = get('floor lamp')[0];
      if (lamp) put('floor lamp', lamp, add(add(sp, back.t, s.w / 2 + 0.3), back.n, -0.1), rot);
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(sp), 0);
      const shelf = get('shelf')[0];
      const sw = side(back, [back, tvWall].filter(Boolean) as Wall[]);
      if (shelf && sw) put('shelf', shelf, add(sw.mid, sw.n, m(shelf).d / 2 + 0.03), faceRot(sw.n));
    }
  } else if (type === 'bedroom') {
    const head = freeWall();
    const bed = get('bed')[0];
    if (head && bed) {
      const b = m(bed);
      const bp = add(head.mid, head.n, b.d / 2 + 0.03);
      const rot = faceRot(head.n);
      put('bed', bed, bp, rot);
      get('nightstand').slice(0, 2).forEach((ns, i) => {
        const sgn = i === 0 ? -1 : 1;
        const p = add(add(head.mid, head.n, m(ns).d / 2 + 0.03), head.t, sgn * (b.w / 2 + m(ns).w / 2 + 0.04));
        put('nightstand', ns, p, rot);
      });
      const rug = get('rug')[0];
      if (rug) put('rug', rug, add(bp, head.n, b.d * 0.2), rot + (m(rug).w > m(rug).d ? Math.PI / 2 : 0));
      const opp = opposite(head);
      const dr = get('dresser')[0];
      if (dr && opp) put('dresser', dr, add(opp.mid, opp.n, m(dr).d / 2 + 0.03), faceRot(opp.n));
      const lamp = get('floor lamp')[0];
      const sw = side(head, [head]);
      if (lamp && sw) put('floor lamp', lamp, add(add(sw.mid, sw.n, 0.3), sw.t, sw.len / 2 - 0.4), 0);
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(bp), 0);
    }
  } else if (type === 'dining') {
    const table = get('dining table')[0];
    const ref = walls[0];
    if (table && ref) {
      const t = m(table);
      const rot = faceRot(ref.n) + Math.PI / 2; // table's long side parallel to the longest wall
      put('dining table', table, c, rot);
      const rug = get('rug')[0];
      if (rug) put('rug', rug, c, rot);
      const chairs = get('dining chair');
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const local = (x: number, y: number): Vec2 => ({ x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos });
      const round = table.category === 'round-table';
      const seats: { p: Vec2; face: Vec2 }[] = [];
      const offs = round ? [] : t.w >= 1.4 ? [-t.w / 4, t.w / 4] : [0];
      for (const ox of offs) {
        for (const sgn of [-1, 1]) {
          const p = local(ox, sgn * (t.d / 2 + 0.28));
          seats.push({ p, face: { x: c.x - p.x, y: c.y - p.y } });
        }
      }
      if (round) {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + rot;
          const p = add(c, { x: Math.cos(a), y: Math.sin(a) }, t.w / 2 + 0.28);
          seats.push({ p, face: { x: c.x - p.x, y: c.y - p.y } });
        }
      } else if (offs.length === 1) {
        for (const sgn of [-1, 1]) {
          const p = local(sgn * (t.w / 2 + 0.28), 0);
          seats.push({ p, face: { x: c.x - p.x, y: c.y - p.y } });
        }
      }
      chairs.forEach((ch, i) => {
        const s = seats[i];
        if (!s) return;
        const l = Math.hypot(s.face.x, s.face.y) || 1;
        put('dining chair', ch, s.p, faceRot({ x: s.face.x / l, y: s.face.y / l }));
      });
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(c), 0);
    }
  } else {
    const wall = [...walls].sort((x, y) => x.doorPenalty - y.doorPenalty || x.len - y.len).find((w) => w.len >= 1.2) ?? walls[0];
    const desk = get('desk')[0];
    if (wall && desk) {
      const dp = add(wall.mid, wall.n, m(desk).d / 2 + 0.03);
      put('desk', desk, dp, faceRot(wall.n));
      const ch = get('office chair')[0];
      if (ch) put('office chair', ch, add(dp, wall.n, m(desk).d / 2 + 0.25), faceRot({ x: -wall.n.x, y: -wall.n.y }));
      const shelf = get('shelf')[0];
      const sw = side(wall, [wall]);
      if (shelf && sw) put('shelf', shelf, add(sw.mid, sw.n, m(shelf).d / 2 + 0.03), faceRot(sw.n));
      const lamp = get('floor lamp')[0];
      if (lamp) put('floor lamp', lamp, add(add(dp, wall.t, m(desk).w / 2 + 0.3), wall.n, -0.05), 0);
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(dp), 0);
    }
  }

  // Drop optional pieces that create errors or tight walkways, lowest priority first, until the layout is clean.
  const dropped: { role: string; product: Product; reason: string }[] = [];
  const order = TEMPLATES[type].map((r) => r.role);
  const byId = new Map(picks.map((p) => [p.product.id, p.product]));
  for (let guard = 0; guard < 12; guard++) {
    const withUid = placed.map((p, i) => ({ item: { ...p, uid: String(i) }, product: byId.get(p.productId)! }));
    const errs = checkFit(withUid, [room], doors).filter((i) => i.level === 'error' || i.message.startsWith('Walkway'));
    if (!errs.length) break;
    const bad = [...new Set(errs.map((e) => Number(e.uid)))].sort(
      (a, b) => order.indexOf(placed[b].role) - order.indexOf(placed[a].role),
    )[0];
    const victim = placed[bad];
    if (order.indexOf(victim.role) === 0 && placed.length === 1) break;
    dropped.push({ role: victim.role, product: byId.get(victim.productId)!, reason: errs.find((e) => Number(e.uid) === bad)!.message });
    placed.splice(bad, 1);
  }
  return { placed, dropped };
}

// Deterministic picker used when no LLM is configured (and as the candidate filter for the LLM).
export function pickProducts(type: RoomType, theme: ThemeId | null, budget: number, room: Room, products: Product[]): { role: string; product: Product }[] {
  const picks: { role: string; product: Product }[] = [];
  let spent = 0;
  const maxW = Math.max(room.widthM, room.depthM);
  for (const role of TEMPLATES[type]) {
    const count = role.count ?? 1;
    const share = budget * role.weight;
    const pool = products
      .filter((p) => role.alts.includes(p.category) && p.placement === 'floor')
      .filter((p) => p.dimsCm.w / 100 <= maxW - 0.4 && (!room.heightM || p.dimsCm.h / 100 < room.heightM))
      .sort((a, b) => {
        const ta = theme && a.styles.includes(theme) ? 0 : 1;
        const tb = theme && b.styles.includes(theme) ? 0 : 1;
        const fa = a.priceUsd * count <= share ? 0 : 1;
        const fb = b.priceUsd * count <= share ? 0 : 1;
        return ta - tb || fa - fb || b.priceUsd - a.priceUsd;
      });
    const choice = pool.find((p) => spent + p.priceUsd * count <= budget);
    if (!choice) continue;
    for (let i = 0; i < count; i++) picks.push({ role: role.role, product: choice });
    spent += choice.priceUsd * count;
  }
  return picks;
}
