import { hangLift } from './hang';
import { checkFlow, type FlowContext } from './circulation';
import { centroid, convexSeparation, distPointSegment, pointInPolygon, polygonArea, rectCorners } from './geometry';
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
export type Role = { role: string; alts: Category[]; count?: number; weight: number; optional?: boolean; wall?: boolean; raised?: 'table' | 'counter' }; // wall: hangs on a wall; raised: stands on a table or counter

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
    { role: 'wall art', alts: ['wall-art'], weight: 0.05, optional: true, wall: true },
    { role: 'counter flower pot', alts: ['decor', 'plant'], weight: 0.03, optional: true, raised: 'counter' },
  ],
  // A complete bedroom, as IKEA stages it: bed, a bedside table each side, storage, rug, bench.
  bedroom: [
    { role: 'bed', alts: ['bed'], weight: 0.34 },
    { role: 'nightstand', alts: ['nightstand'], count: 2, weight: 0.1 },
    { role: 'dresser', alts: ['dresser'], weight: 0.14, optional: true },
    { role: 'wardrobe', alts: ['wardrobe'], weight: 0.14, optional: true },
    { role: 'rug', alts: ['rug'], weight: 0.08, optional: true },
    { role: 'bench', alts: ['bench'], weight: 0.06, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.04, optional: true },
    { role: 'mirror', alts: ['mirror'], weight: 0.06, optional: true, wall: true },
    { role: 'wall art', alts: ['wall-art'], weight: 0.05, optional: true, wall: true },
  ],
  dining: [
    { role: 'dining table', alts: ['dining-table', 'round-table'], weight: 0.45 },
    { role: 'dining chair', alts: ['dining-chair'], count: 4, weight: 0.35 },
    { role: 'rug', alts: ['rug'], weight: 0.1, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.05, optional: true },
    { role: 'table flower pot', alts: ['decor', 'plant'], weight: 0.03, optional: true, raised: 'table' },
  ],
  office: [
    { role: 'desk', alts: ['desk'], weight: 0.4 },
    { role: 'office chair', alts: ['office-chair'], weight: 0.3 },
    { role: 'shelf', alts: ['bookshelf'], weight: 0.15, optional: true },
    { role: 'plant', alts: ['plant'], weight: 0.05, optional: true },
  ],
};

// A big dining room is usually an open-plan space: a dining set plus a lounge (sofa, TV, rug).
export const OPEN_DINING_MIN_M2 = 20;
export const isOpenDining = (room: Room) =>
  roomTypeOf(room.label) === 'dining' && (room.areaM2 || polygonArea(room.polygon)) >= OPEN_DINING_MIN_M2;
export const OPEN_DINING: Role[] = [
  { role: 'dining table', alts: ['dining-table', 'round-table'], weight: 0.2 },
  { role: 'dining chair', alts: ['dining-chair'], count: 4, weight: 0.12 },
  { role: 'sofa', alts: ['sofa', 'sectional'], weight: 0.26 },
  { role: 'coffee table', alts: ['coffee-table'], weight: 0.06 },
  { role: 'tv console', alts: ['tv-console'], weight: 0.1 },
  { role: 'rug', alts: ['rug'], weight: 0.08 },
  { role: 'armchair', alts: ['armchair'], weight: 0.1, optional: true },
  { role: 'plant', alts: ['plant'], weight: 0.04, optional: true },
  { role: 'shelf', alts: ['bookshelf'], weight: 0.04, optional: true },
  { role: 'wall art', alts: ['wall-art'], weight: 0.04, optional: true, wall: true },
  { role: 'table flower pot', alts: ['decor', 'plant'], weight: 0.03, optional: true, raised: 'table' },
  { role: 'counter flower pot', alts: ['decor', 'plant'], weight: 0.03, optional: true, raised: 'counter' },
];

// The roomiest spots in a room (furthest from walls and fixtures), best first and spaced apart.
// An L-shaped or open-plan room's centroid can sit on its inner corner; these never do.
function roomiestSpots(room: Room, scene?: SceneInfo): Vec2[] {
  const poly = room.polygon;
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const edges = (pts: Vec2[]) => pts.map((a, i) => [a, pts[(i + 1) % pts.length]] as const);
  const wallEdges = edges(poly);
  const spots: { p: Vec2; clear: number }[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.3) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.3) {
      const p = { x, y };
      if (!pointInPolygon(p, poly)) continue;
      let clear = Math.min(...wallEdges.map(([a, b]) => distPointSegment(p, a, b)));
      for (const f of scene?.fixtures ?? []) {
        if (f.length < 3) continue;
        clear = pointInPolygon(p, f) ? 0 : Math.min(clear, ...edges(f).map(([a, b]) => distPointSegment(p, a, b)));
      }
      spots.push({ p, clear });
    }
  }
  spots.sort((a, b) => b.clear - a.clear);
  const best = spots[0]?.clear ?? 0;
  const out: Vec2[] = [];
  for (const s of spots) {
    if (s.clear < best * 0.6) break;
    if (out.every((q) => Math.hypot(q.x - s.p.x, q.y - s.p.y) > 1.2)) out.push(s.p);
    if (out.length >= 3) break;
  }
  return out;
}

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
export type SceneInfo = {
  windows: { a: Vec2; b: Vec2 }[];
  fixtures: Vec2[][];
  // Whether a flat piece fits on the wall's real surface there: centre c, wall normal n and
  // tangent t, width w, bottom and top heights above the floor (a window or recess says no).
  probe?: (c: Vec2, n: Vec2, t: Vec2, w: number, y0: number, y1: number) => boolean;
  counters?: { p: Vec2; h: number }[]; // spots on a kitchen counter, with the counter top's height
};
export type SolveInput = {
  room: Room;
  doors: DoorMark[];
  picks: { role: string; product: Product }[];
  anchor?: number;
  walls?: Record<string, ApiWall[]>;
  flow?: FlowContext;
  scene?: SceneInfo;
  // Whether a wall (by its end points) is interior; hung pieces go only on interior walls, since windows
  // and glass doors are on exterior ones and the scan does not always show them. Omitted: any wall.
  interior?: (a: Vec2, b: Vec2) => boolean;
};
export type Placement = Omit<PlacedItem, 'uid'> & { role: string };

export function solveLayout({ room, doors, picks, anchor = 0, walls: fitWalls, flow, scene, interior }: SolveInput): { placed: Placement[]; dropped: { role: string; product: Product; reason: string }[] } {
  const type = roomTypeOf(room.label);
  const walls = roomWalls(room, doors).sort((x, y) => y.len - x.len);
  const z = room.floorZ;
  const c = centroid(room.polygon);
  const placed: Placement[] = [];
  const get = (role: string) => picks.filter((p) => p.role === role).map((p) => p.product);
  const put = (role: string, product: Product, pos: Vec2, rot: number) =>
    placed.push({ role, productId: product.id, roomId: room.id, pos: { x: pos.x, y: pos.y, z }, rot });
  // Hang a flat piece on a wall, centred `along` metres from the wall's start. It keeps off doors,
  // closets and windows, and (when the scan can be probed) off anything that is not plain wall.
  const alongOf = (p: Vec2, w: Wall) => (p.x - w.a.x) * w.t.x + (p.y - w.a.y) * w.t.y;
  const blockedSpans = (w: Wall): [number, number][] => {
    const spans: [number, number][] = [];
    for (const d of doors) {
      if (distToSeg(d.pos, w.a, w.b) < 0.45) {
        const c = alongOf(d.pos, w);
        spans.push([c - d.widthM / 2 - 0.25, c + d.widthM / 2 + 0.25]);
      }
    }
    for (const win of scene?.windows ?? []) {
      if (distToSeg(win.a, w.a, w.b) < 0.5 && distToSeg(win.b, w.a, w.b) < 0.5) {
        const p = alongOf(win.a, w);
        const q = alongOf(win.b, w);
        spans.push([Math.min(p, q) - 0.25, Math.max(p, q) + 0.25]);
      }
    }
    return spans;
  };
  const hang = (role: string, product: Product, w: Wall, along: number): boolean => {
    if (interior && !interior(w.a, w.b)) return false;
    const pr = m(product);
    const half = pr.w / 2 + 0.08;
    const spans = blockedSpans(w);
    const lift = hangLift(product);
    // A full-length mirror needs open floor in front of it: nothing already placed within a metre. (A
    // small one hangs above furniture, which is fine.)
    const frontClear = (c: number) => {
      if (role !== 'mirror' || product.dimsCm.h < 150) return true;
      const zone = rectCorners(add(add(w.a, w.t, c), w.n, 0.65), pr.w + 0.2, 1.0, faceRot(w.n));
      return placed.every((pl) => {
        const pp = picks.find((x) => x.product.id === pl.productId)?.product;
        if (!pp || pp.placement === 'wall' || pp.category === 'rug' || pl.role.endsWith('flower pot')) return true;
        return convexSeparation(zone, rectCorners({ x: pl.pos.x, y: pl.pos.y }, pp.dimsCm.w / 100, pp.dimsCm.d / 100, pl.rot)) > 0.02;
      });
    };
    const ok = (c: number) => {
      if (c - half < 0.05 || c + half > w.len - 0.05) return false;
      if (spans.some(([lo, hi]) => c + half > lo && c - half < hi)) return false;
      if (!frontClear(c)) return false;
      const at = add(w.a, w.t, c);
      const from = add(at, w.n, 0.12);
      return !scene?.probe || scene.probe(from, w.n, w.t, pr.w, z + lift, z + lift + product.dimsCm.h / 100);
    };
    for (let k = 0; k <= Math.ceil(w.len / 0.15); k++) {
      for (const sgn of k ? [-1, 1] : [1]) {
        const c = along + sgn * k * 0.15;
        if (!ok(c)) continue;
        put(role, product, add(add(w.a, w.t, c), w.n, pr.d / 2 + WALL_GAP), faceRot(w.n));
        return true;
      }
    }
    return false;
  };
  // On the preferred wall near `along`; else on any other wall that has room, longest first.
  const hangNear = (role: string, product: Product, prefer: Wall | undefined, along: number, exclude: Wall[] = []) => {
    if (prefer && !exclude.includes(prefer) && hang(role, product, prefer, along)) return true;
    return [...walls].filter((w) => w !== prefer && !exclude.includes(w) && w.len >= 1).some((w) => hang(role, product, w, w.len / 2));
  };
  // A piece standing on something: `lift` metres above the floor.
  const putRaised = (role: string, product: Product, pos: Vec2, lift: number) =>
    placed.push({ role, productId: product.id, roomId: room.id, pos: { x: pos.x, y: pos.y, z: z + lift }, rot: 0 });
  // A wall a storage piece can stand against: no door beside it, and (when the scan can be probed)
  // plain wall across the piece's width up to its height, not a louvered closet, recess or window.
  const storageWall = (prefer: Wall | undefined, product: Product, exclude: Wall[] = []): Wall | undefined => {
    const pr = m(product);
    const plain = (w: Wall) =>
      !exclude.includes(w) &&
      w.len >= pr.w + 0.3 &&
      w.doorPenalty === 0 &&
      (!scene?.probe || scene.probe(add(add(w.a, w.t, w.len / 2), w.n, 0.12), w.n, w.t, Math.min(pr.w + 0.2, w.len - 0.2), z + 0.25, z + Math.min(product.dimsCm.h / 100, 1.6)));
    return [prefer, ...walls].filter((w): w is Wall => !!w).find(plain) ?? undefined;
  };
  const freeWall = (exclude: Wall[] = []) =>
    walls.filter((w) => !exclude.includes(w)).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len)[0];
  // Candidate walls for the main piece, best first; `anchor` picks one of them.
  const anchors = walls.filter((w) => w.len >= 1.2).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len);
  const anchorWall = () => (anchors.length ? anchors[anchor % anchors.length] : freeWall());
  const opposite = (w: Wall) =>
    walls.filter((o) => o !== w && o.n.x * w.n.x + o.n.y * w.n.y < -0.7).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len)[0];
  const side = (w: Wall, exclude: Wall[]) =>
    walls.filter((o) => !exclude.includes(o) && Math.abs(o.n.x * w.n.x + o.n.y * w.n.y) < 0.3).sort((x, y) => x.doorPenalty - y.doorPenalty || y.len - x.len)[0];
  const corner = (awayFrom: Vec2) => {
    const v = [...room.polygon].sort((p, q) => Math.hypot(q.x - awayFrom.x, q.y - awayFrom.y) - Math.hypot(p.x - awayFrom.x, p.y - awayFrom.y))[0];
    const dir = { x: c.x - v.x, y: c.y - v.y };
    const l = Math.hypot(dir.x, dir.y) || 1;
    return add(v, { x: dir.x / l, y: dir.y / l }, 0.45);
  };

  const placeLiving = (back: Wall | undefined) => {
    const sofa = get('sofa')[0];
    if (back && sofa) {
      const s = m(sofa);
      const sp = add(back.mid, back.n, s.d / 2 + WALL_GAP);
      const rot = faceRot(back.n);
      put('sofa', sofa, sp, rot);
      const art = get('wall art')[0];
      if (art) hangNear('wall art', art, back, alongOf(sp, back)); // above the sofa, else a clear wall
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
  };
  if (type === 'living') {
    placeLiving(anchorWall());
  } else if (type === 'bedroom') {
    const head = anchorWall();
    const bed = get('bed')[0];
    if (head && bed) {
      const b = m(bed);
      const bp = add(head.mid, head.n, b.d / 2 + WALL_GAP);
      const rot = faceRot(head.n);
      put('bed', bed, bp, rot);
      const art = get('wall art')[0];
      if (art) hangNear('wall art', art, head, alongOf(bp, head)); // above the headboard, else a clear wall
      const rug = get('rug')[0];
      if (rug) put('rug', rug, add(bp, head.n, b.d * 0.2), rot + (m(rug).w > m(rug).d ? Math.PI / 2 : 0));
      // A bedside table each side of the headboard, against the wall.
      get('nightstand').forEach((ns, i) => {
        const sgn = i % 2 === 0 ? -1 : 1;
        const along = add(head.mid, head.t, sgn * (b.w / 2 + m(ns).w / 2 + 0.04));
        put('nightstand', ns, add(along, head.n, m(ns).d / 2 + WALL_GAP), faceRot(head.n));
      });
      const dr = get('dresser')[0];
      const opp = dr ? (storageWall(opposite(head), dr, [head]) ?? opposite(head)) : opposite(head);
      if (dr && opp && storageWall(opp, dr, [head]) === opp) put('dresser', dr, add(opp.mid, opp.n, m(dr).d / 2 + WALL_GAP), faceRot(opp.n));
      // A mirror: small ones hang above the dresser; a full-length one stands against the wall beside it.
      const mir = get('mirror')[0];
      if (mir) {
        const mw = m(mir).w;
        // Never on the headboard wall (the painting goes there).
        if (dr && opp) hangNear('mirror', mir, opp, mir.dimsCm.h >= 150 ? opp.len / 2 + m(dr).w / 2 + mw / 2 + 0.15 : opp.len / 2, [head]);
        else hangNear('mirror', mir, side(head, [head]) ?? opp, ((side(head, [head]) ?? opp)?.len ?? 2) / 2, [head]);
      }
      // Wardrobe on a side wall (or, failing that, beside the dresser's wall).
      const wr = get('wardrobe')[0];
      const wrWall = wr ? storageWall(side(head, [head, opp].filter(Boolean) as Wall[]) ?? opp, wr, [head]) : undefined;
      if (wr && wrWall) put('wardrobe', wr, add(wrWall.mid, wrWall.n, m(wr).d / 2 + WALL_GAP), faceRot(wrWall.n));
      // Bench at the foot of the bed.
      const bn = get('bench')[0];
      if (bn) put('bench', bn, add(bp, head.n, b.d / 2 + m(bn).d / 2 + 0.08), rot);
      const plant = get('plant')[0];
      if (plant) put('plant', plant, corner(bp), 0);
    }
  } else if (type === 'dining') {
    const open = isOpenDining(room);
    const table = get('dining table')[0];
    const ref = walls.length ? walls[anchor % walls.length] : undefined;
    // Set the table at the roomiest spot, not the centroid, which can sit on an L's inner corner.
    const spots = roomiestSpots(room, scene);
    const cc = spots.length ? spots[anchor % spots.length] : c;
    const wallPick = Math.floor(anchor / Math.max(spots.length, 1));
    if (table && ref) {
      const t = m(table);
      const rot = faceRot(ref.n) + Math.PI / 2; // table's long side parallel to the longest wall
      put('dining table', table, cc, rot);
      const rug = get('rug')[0];
      if (rug && !open) put('rug', rug, cc, rot); // an open-plan room's rug goes under the sofa instead
      const chairs = get('dining chair');
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const local = (x: number, y: number): Vec2 => ({ x: cc.x + x * cos - y * sin, y: cc.y + x * sin + y * cos });
      const round = table.category === 'round-table';
      const seats: { p: Vec2; face: Vec2 }[] = [];
      const offs = round ? [] : t.w >= 1.4 ? [-t.w / 4, t.w / 4] : [0];
      // Chairs face straight into the table (not at its centre, which tilts the corner seats so their
      // corners cut into the table edge): a long-side chair looks along the table's width.
      for (const ox of offs) {
        for (const sgn of [-1, 1]) {
          const p = local(ox, sgn * (t.d / 2 + 0.28));
          seats.push({ p, face: { x: sgn * sin, y: -sgn * cos } });
        }
      }
      if (round) {
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + rot;
          const p = add(cc, { x: Math.cos(a), y: Math.sin(a) }, t.w / 2 + 0.28);
          seats.push({ p, face: { x: cc.x - p.x, y: cc.y - p.y } });
        }
      } else if (offs.length === 1) {
        for (const sgn of [-1, 1]) {
          const p = local(sgn * (t.w / 2 + 0.28), 0);
          seats.push({ p, face: { x: -sgn * cos, y: -sgn * sin } });
        }
      }
      chairs.forEach((ch, i) => {
        const s = seats[i];
        if (!s) return;
        const l = Math.hypot(s.face.x, s.face.y) || 1;
        put('dining chair', ch, s.p, faceRot({ x: s.face.x / l, y: s.face.y / l }));
      });
      const pot = get('table flower pot')[0];
      if (pot) putRaised('table flower pot', pot, cc, table.dimsCm.h / 100); // a flower pot in the middle of the table
      if (open) {
        // The lounge backs onto a long wall as far from the dining set as the room allows.
        const far = anchors
          .filter((w) => w.len >= 1.6)
          .sort((x, y) => x.doorPenalty - y.doorPenalty || Math.hypot(y.mid.x - cc.x, y.mid.y - cc.y) - Math.hypot(x.mid.x - cc.x, x.mid.y - cc.y));
        placeLiving(far.length ? far[wallPick % far.length] : undefined);
      }
      const plant = get('plant')[0];
      if (plant && !open) put('plant', plant, corner(cc), 0);
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

  // A flower pot on the kitchen counter, where the scan shows one.
  const counterPot = get('counter flower pot')[0];
  const counter = scene?.counters?.[0];
  if (counterPot && counter) putRaised('counter flower pot', counterPot, counter.p, counter.h);

  // Drop pieces that create errors, tight walkways, blocked doors or cut-off paths, lowest
  // priority first, until the layout is clean.
  const dropped: { role: string; product: Product; reason: string }[] = [];
  const order = (isOpenDining(room) ? OPEN_DINING : TEMPLATES[type]).map((r) => r.role);
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
    if (pr.placement === 'wall' || p.role.endsWith('flower pot')) return; // hung, or standing on a table or counter
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
    .filter(({ p, pr }) => pr.category !== 'rug' && pr.placement !== 'wall' && !p.role.endsWith('flower pot')) // rugs, wall art and pots on a table leave the floor free
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
