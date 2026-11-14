import { checkFlow, type FlowContext } from './circulation';
import { centroid, convexSeparation, distPointSegment, pointInPolygon, rectCorners } from './geometry';
import { checkFit } from './fit';
import type { Category, DoorMark, PlacedItem, Product, Room, ThemeId, Vec2, Wall as ApiWall } from './types';

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
    { role: 'plant', alts: ['plant'], weight: 0.04, optional: true },
    { role: 'shelf', alts: ['bookshelf'], weight: 0.05, optional: true },
  ],
  bedroom: [
    { role: 'bed', alts: ['bed'], weight: 0.45 },
    { role: 'dresser', alts: ['dresser'], weight: 0.2, optional: true },
    { role: 'rug', alts: ['rug'], weight: 0.1, optional: true },
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

// Room outlines run along wall centre lines, so a piece backed onto a wall sits half a wall's
// thickness (about 6-8 cm) plus a little air off the outline.
const WALL_GAP = 0.11;

// Rotation that makes an item's front (API local -y at rot 0) face direction n.
const faceRot = (n: Vec2) => Math.atan2(n.x, -n.y);
const add = (p: Vec2, v: Vec2, s: number): Vec2 => ({ x: p.x + v.x * s, y: p.y + v.y * s });
const m = (p: Product) => ({ w: p.dimsCm.w / 100, d: p.dimsCm.d / 100 });

// anchor: which candidate wall (0 = best) the main piece backs onto, so an optimiser can try
// several layouts. walls: the scan's walls by floor, for the wall-thickness fit check.
// flow: where people need to walk (see circulation.ts); pieces that cut it off are dropped.
// scene: what the scan shows (see scanSense.ts): windows to keep tall pieces out of, and fixed
// fixtures (counters, built-ins) nothing may stand on.
export type SceneInfo = { windows: { a: Vec2; b: Vec2 }[]; fixtures: Vec2[][] };
export type SolveInput = {
  room: Room;
  doors: DoorMark[];
  picks: { role: string; product: Product }[];
  anchor?: number;
  walls?: Record<string, ApiWall[]>;
  flow?: FlowContext;
  scene?: SceneInfo;
};
export type Placement = Omit<PlacedItem, 'uid'> & { role: string };

export function solveLayout({ room, doors, picks, anchor = 0, walls: fitWalls, flow, scene }: SolveInput): { placed: Placement[]; dropped: { role: string; product: Product; reason: string }[] } {
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
  // Candidate walls for the main piece, best first; `anchor` picks one of them.
  const anchors = walls.filter((w) => w.len >= 1.2).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len);
  const anchorWall = () => (anchors.length ? anchors[anchor % anchors.length] : freeWall());
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
    const back = anchorWall();
    const sofa = get('sofa')[0];
    if (back && sofa) {
      const s = m(sofa);
      const sp = add(back.mid, back.n, s.d / 2 + WALL_GAP);
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
        put('tv console', tv, add(base, tvWall.n, m(tv).d / 2 + WALL_GAP), faceRot(tvWall.n));
      }
      const chair = get('armchair')[0];
      if (chair) {
        const t = back.t;
        const reach = (ct ? m(ct).w / 2 : 0.5) + 0.35 + m(chair).d / 2;
        put('armchair', chair, add(ctPos, t, reach), faceRot({ x: -t.x, y: -t.y }));
      }
      const st = get('side table')[0];
      if (st) put('side table', st, add(sp, back.t, -(s.w / 2 + m(st).w / 2 + 0.05)), rot);
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(sp), 0);
      const shelf = get('shelf')[0];
      const sw = side(back, [back, tvWall].filter(Boolean) as Wall[]);
      if (shelf && sw) put('shelf', shelf, add(sw.mid, sw.n, m(shelf).d / 2 + WALL_GAP), faceRot(sw.n));
    }
  } else if (type === 'bedroom') {
    const head = anchorWall();
    const bed = get('bed')[0];
    if (head && bed) {
      const b = m(bed);
      const bp = add(head.mid, head.n, b.d / 2 + WALL_GAP);
      const rot = faceRot(head.n);
      put('bed', bed, bp, rot);
      const rug = get('rug')[0];
      if (rug) put('rug', rug, add(bp, head.n, b.d * 0.2), rot + (m(rug).w > m(rug).d ? Math.PI / 2 : 0));
      const opp = opposite(head);
      const dr = get('dresser')[0];
      if (dr && opp) put('dresser', dr, add(opp.mid, opp.n, m(dr).d / 2 + WALL_GAP), faceRot(opp.n));
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(bp), 0);
    }
  } else if (type === 'dining') {
    const table = get('dining table')[0];
    const ref = walls.length ? walls[anchor % walls.length] : undefined;
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
    const desks = [...walls].sort((x, y) => x.doorPenalty - y.doorPenalty || x.len - y.len).filter((w) => w.len >= 1.2);
    const wall = desks.length ? desks[anchor % desks.length] : walls[0];
    const desk = get('desk')[0];
    if (wall && desk) {
      const dp = add(wall.mid, wall.n, m(desk).d / 2 + WALL_GAP);
      put('desk', desk, dp, faceRot(wall.n));
      const ch = get('office chair')[0];
      if (ch) put('office chair', ch, add(dp, wall.n, m(desk).d / 2 + m(ch).d / 2 + 0.05), faceRot({ x: -wall.n.x, y: -wall.n.y })); // pulled out, not overlapping
      const shelf = get('shelf')[0];
      const sw = side(wall, [wall]);
      if (shelf && sw) put('shelf', shelf, add(sw.mid, sw.n, m(shelf).d / 2 + WALL_GAP), faceRot(sw.n));
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(dp), 0);
    }
  }

  // Drop pieces that create errors, tight walkways, blocked doors or cut-off paths, lowest
  // priority first, until the layout is clean.
  const dropped: { role: string; product: Product; reason: string }[] = [];
  const order = TEMPLATES[type].map((r) => r.role);
  const byId = new Map(picks.map((p) => [p.product.id, p.product]));
  const lowestFirst = () => placed.map((_, i) => i).sort((a, b) => order.indexOf(placed[b].role) - order.indexOf(placed[a].role));
  for (let guard = 0; guard < 16; guard++) {
    const withUid = placed.map((p, i) => ({ item: { ...p, uid: String(i) }, product: byId.get(p.productId)! }));
    const errs = [
      ...checkFit(withUid, [room], doors, fitWalls).filter(
        (i) => i.level === 'error' || i.message.startsWith('Walkway') || i.message.startsWith('Blocks a door'),
      ),
      ...(scene ? sceneIssues(placed, byId, scene) : []),
    ];
    if (!errs.length) {
      if (!flow || flowClear(room, placed, byId, flow)) break;
      // Something cuts off a doorway or a walking route: drop the least important piece whose
      // removal opens it up (or failing that, the least important piece that isn't the anchor).
      const candidates = lowestFirst().filter((i) => order.indexOf(placed[i].role) > 0 && byId.get(placed[i].productId)!.category !== 'rug');
      if (!candidates.length) break;
      // If even the main piece alone blocks it, removing others won't help: leave the layout
      // for the optimiser to score against other walls.
      const anchorOnly = placed.filter((_, k) => !candidates.includes(k));
      if (!flowClear(room, anchorOnly, byId, flow)) break;
      const fix = candidates.find((i) => flowClear(room, placed.filter((_, k) => k !== i), byId, flow)) ?? candidates[0];
      dropped.push({ role: placed[fix].role, product: byId.get(placed[fix].productId)!, reason: 'Would block a path through the room' });
      placed.splice(fix, 1);
      continue;
    }
    const bad = [...new Set(errs.map((e) => Number(e.uid)))].sort(
      (a, b) => order.indexOf(placed[b].role) - order.indexOf(placed[a].role),
    )[0];
    const victim = placed[bad];
    // Never drop the main piece (bed, sofa, table, desk); the optimiser tries it on other walls.
    if (order.indexOf(victim.role) === 0) break;
    dropped.push({ role: victim.role, product: byId.get(victim.productId)!, reason: errs.find((e) => Number(e.uid) === bad)!.message });
    placed.splice(bad, 1);
  }
  return { placed, dropped };
}

// Pieces that clash with what the scan shows: standing on a counter or built-in, or a tall piece
// in front of a window.
export function sceneIssues(placed: Placement[], byId: Map<string, Product>, scene: SceneInfo): { uid: string; message: string }[] {
  const out: { uid: string; message: string }[] = [];
  placed.forEach((p, i) => {
    const pr = byId.get(p.productId)!;
    const fp = rectCorners({ x: p.pos.x, y: p.pos.y }, pr.dimsCm.w / 100, pr.dimsCm.d / 100, p.rot);
    if (scene.fixtures.some((f) => convexSeparation(fp, f) < -0.02)) out.push({ uid: String(i), message: 'Sits on a counter or built-in' });
    else if (pr.dimsCm.h > 90 && scene.windows.some((w) => fp.some((c) => distPointSegment(c, w.a, w.b) < 0.4))) {
      out.push({ uid: String(i), message: 'Stands in front of a window' });
    }
  });
  return out;
}

// Whether people can still walk through the room with these pieces in it (rugs don't count).
export function flowClear(room: Room, placed: Placement[], byId: Map<string, Product>, flow: FlowContext): boolean {
  const solid = placed
    .map((p) => ({ p, pr: byId.get(p.productId)! }))
    .filter(({ pr }) => pr.category !== 'rug')
    .map(({ p, pr }) => rectCorners({ x: p.pos.x, y: p.pos.y }, pr.dimsCm.w / 100, pr.dimsCm.d / 100, p.rot));
  return checkFlow(room, solid, flow).ok;
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
