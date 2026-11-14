import { distPointSegment, pointInPolygon, segmentsOfPolygon } from './geometry';
import type { Pano, Room, Vec2 } from './types';

// Can a person still walk through the room? The floor is rasterised at 10 cm; a cell is open
// when it is inside the room and a person-width path (60 cm, so 30 cm either side) clears
// every piece of furniture. The room passes when one connected open area reaches:
//   - every spot the photographer stood just inside a doorway (panos within a metre of a wall
//     shared with another room; panos mid-room are ignored, a coffee table may go there)
//   - every wall shared with a neighbouring room that has panos (the doorway is somewhere on
//     it; Matterport's walls run straight across doors, so we can't see exactly where)
//   - every door the user marked

const CELL = 0.1;
const HALF_PATH = 0.3;
const WALL_AIR = 0.12; // the path may run close to a wall, not inside it

// blockers: fixed things in the room (counters, built-ins) that block a path like furniture does.
export type FlowContext = { stand: Vec2[]; shared: [Vec2, Vec2][][]; blockers?: Vec2[][] };

export function flowContext(room: Room, rooms: Room[], panos: Pano[], doors: Vec2[] = []): FlowContext {
  const onFloor = (p: Pano) => !p.floorId || p.floorId === room.floorId;
  const mine = panos.filter((p) => onFloor(p) && pointInPolygon(p.pos, room.polygon)).map((p) => ({ x: p.pos.x, y: p.pos.y }));
  const shared: [Vec2, Vec2][][] = [];
  for (const o of rooms) {
    if (o.id === room.id || o.floorId !== room.floorId) continue;
    if (!panos.some((p) => onFloor(p) && pointInPolygon(p.pos, o.polygon))) continue; // closets nobody scanned
    const segs = segmentsOfPolygon(o.polygon);
    // Pieces of this room's outline that run along the neighbour's.
    const strip: [Vec2, Vec2][] = [];
    for (const [a, b] of segmentsOfPolygon(room.polygon)) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.round(len / CELL));
      let start: Vec2 | null = null;
      let prev: Vec2 | null = null;
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        const near = segs.some(([c, d]) => distPointSegment(p, c, d) < 0.35);
        if (near && !start) start = p;
        if (!near && start && prev) {
          strip.push([start, prev]);
          start = null;
        }
        prev = p;
      }
      if (start && prev) strip.push([start, prev]);
    }
    const long = strip.filter(([a, b]) => Math.hypot(b.x - a.x, b.y - a.y) >= 0.6);
    if (long.length) shared.push(long);
  }
  const byDoor = mine.filter((p) => shared.some((strip) => strip.some(([a, b]) => distPointSegment(p, a, b) < 1)));
  return { stand: [...byDoor, ...doors], shared };
}

export type FlowResult = { ok: boolean; stands: boolean[]; shared: boolean[] };

export function checkFlow(room: Room, pieces: Vec2[][], ctx: FlowContext): FlowResult {
  const footprints = [...pieces, ...(ctx.blockers ?? [])];
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const W = Math.ceil((Math.max(...xs) - x0) / CELL) + 1;
  const H = Math.ceil((Math.max(...ys) - y0) / CELL) + 1;
  const walls = segmentsOfPolygon(room.polygon);
  const edges = footprints.map((f) => segmentsOfPolygon(f));
  const at = (i: number, j: number): Vec2 => ({ x: x0 + (i + 0.5) * CELL, y: y0 + (j + 0.5) * CELL });

  const open = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const p = at(i, j);
      if (!pointInPolygon(p, room.polygon)) continue;
      if (walls.some(([a, b]) => distPointSegment(p, a, b) < WALL_AIR)) continue;
      const blocked = footprints.some((f, k) => pointInPolygon(p, f) || edges[k].some(([a, b]) => distPointSegment(p, a, b) < HALF_PATH));
      if (!blocked) open[j * W + i] = 1;
    }
  }

  // Connected open areas (4-neighbour flood fill).
  const comp = new Int32Array(W * H).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!open[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const i = c % W;
      const j = (c - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const n = nj * W + ni;
        if (open[n] && comp[n] < 0) {
          comp[n] = id;
          stack.push(n);
        }
      }
    }
    sizes.push(size);
  }
  if (!sizes.length) return { ok: false, stands: ctx.stand.map(() => false), shared: ctx.shared.map(() => false) };

  // Which areas each target touches: open cells within `r` of it.
  const touching = (near: (p: Vec2) => boolean, box: [number, number, number, number]) => {
    const ids = new Set<number>();
    const [ax, ay, bx, by] = box;
    for (let j = Math.max(0, Math.floor((ay - y0) / CELL)); j <= Math.min(H - 1, Math.ceil((by - y0) / CELL)); j++) {
      for (let i = Math.max(0, Math.floor((ax - x0) / CELL)); i <= Math.min(W - 1, Math.ceil((bx - x0) / CELL)); i++) {
        const c = j * W + i;
        if (comp[c] >= 0 && near(at(i, j))) ids.add(comp[c]);
      }
    }
    return ids;
  };
  const standIds = ctx.stand.map((s) => touching((p) => Math.hypot(p.x - s.x, p.y - s.y) <= 0.45, [s.x - 0.5, s.y - 0.5, s.x + 0.5, s.y + 0.5]));
  const R = WALL_AIR + 0.25; // a doorway's open cells sit just inside the wall
  const sharedIds = ctx.shared.map((strip) => {
    const ids = new Set<number>();
    for (const [a, b] of strip) {
      const box: [number, number, number, number] = [Math.min(a.x, b.x) - R, Math.min(a.y, b.y) - R, Math.max(a.x, b.x) + R, Math.max(a.y, b.y) + R];
      touching((p) => distPointSegment(p, a, b) <= R, box).forEach((id) => ids.add(id));
    }
    return ids;
  });

  // The main walking area: the one reaching the most targets (ties: the bigger one).
  let main = 0;
  let best = -1;
  for (let id = 0; id < sizes.length; id++) {
    const reach = [...standIds, ...sharedIds].filter((s) => s.has(id)).length;
    if (reach > best || (reach === best && sizes[id] > sizes[main])) [main, best] = [id, reach];
  }
  const stands = standIds.map((s) => s.has(main));
  const shared = sharedIds.map((s) => s.has(main));
  return { ok: stands.every(Boolean) && shared.every(Boolean), stands, shared };
}

// Only the targets an empty room can actually connect (a pano tucked in a narrow alcove, or a
// sliver of shared wall, would otherwise fail every layout).
export function reachableTargets(room: Room, ctx: FlowContext): FlowContext {
  const empty = checkFlow(room, [], ctx);
  return { ...ctx, stand: ctx.stand.filter((_, i) => empty.stands[i]), shared: ctx.shared.filter((_, i) => empty.shared[i]) };
}
