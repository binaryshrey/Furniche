import { centroid, convexSeparation, pointInPolygon, rectCorners } from './geometry';
import type { Category, DoorMark, FitIssue, FitLevel, ModelGeometry, Pano, PlacedItem, Product, Room, Vec2, Vec3, Wall } from './types';

// Clearances in metres. Sources: common interior design guidance
// (36 in walkways where possible, 30 in minimum; 18 in sofa to coffee table).
export const FIT_RULES = {
  walkwayMin: 0.76,
  touchingTolerance: 0.05,
  overlapTolerance: 0.02,
  chairTuck: 0.3, // how far a chair may slide under its table
  companionMin: 0.35, // e.g. sofa to coffee table
  doorClear: 0.9,
  wallTolerance: 0.02, // how far a piece may touch into a wall's thickness before it counts
};

// A wall segment as a rectangle at its real thickness.
function wallRect(w: Wall): Vec2[] {
  const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
  const mid = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
  return rectCorners(mid, len, Math.max(w.thickness, 0.06), Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x));
}

// Rugs lie under furniture; an umbrella canopy hangs over the table and chairs.
const NO_OVERLAP_CHECK: Category[] = ['rug', 'umbrella'];
const SEATING: Category[] = ['sofa', 'sectional', 'armchair', 'bench'];
const LOW_TABLES: Category[] = ['coffee-table', 'side-table'];

// Pairs that are meant to sit close together; walkway rules do not apply between them.
function companions(a: Category, b: Category): boolean {
  const pair = (x: Category[], y: Category[]) => (x.includes(a) && y.includes(b)) || (x.includes(b) && y.includes(a));
  return (
    pair(SEATING, LOW_TABLES) ||
    pair(['bed'], ['nightstand']) ||
    pair(['dining-table', 'round-table', 'patio-table'], ['dining-chair', 'bench', 'patio-chair']) ||
    pair(['desk'], ['office-chair', 'dining-chair']) ||
    pair(['side-table'], ['sofa', 'sectional', 'armchair', 'bed', 'floor-lamp']) ||
    pair(['floor-lamp', 'plant'], [...SEATING, 'bed', 'desk', 'tv-console', 'bookshelf', 'side-table', 'dresser']) ||
    pair(['dining-chair'], ['dining-chair']) ||
    pair(['patio-chair'], ['patio-chair'])
  );
}

export type FitInput = { item: PlacedItem; product: Product };

export function footprint(item: PlacedItem, product: Product): Vec2[] {
  return rectCorners({ x: item.pos.x, y: item.pos.y }, product.dimsCm.w / 100, product.dimsCm.d / 100, item.rot);
}

// In a multi-storey home rooms on different floors overlap in plan, so with a height (a piece
// on the floor, or the camera standing on it) pick the floor that point is on: the highest
// floor at or just below it.
export function roomAt(p: Vec2 | Vec3, rooms: Room[]): Room | null {
  const hits = rooms.filter((r) => pointInPolygon(p, r.polygon));
  if (hits.length < 2 || !('z' in p)) return hits[0] ?? null;
  const below = hits.filter((r) => r.floorZ <= p.z + 0.3).sort((a, b) => b.floorZ - a.floorZ);
  return below[0] ?? [...hits].sort((a, b) => a.floorZ - b.floorZ)[0];
}

// The panorama to stand on to see a room: on the room's own floor, nearest its middle. (Nearest
// by plan position alone can land on the floor above, facing a wall.)
export function panoForRoom(room: Room, panos: Pano[]): Pano | null {
  const onFloor = (p: Pano) => (p.floorId ? p.floorId === room.floorId : p.pos.z > room.floorZ && p.pos.z < room.floorZ + 2.5);
  const c = centroid(room.polygon);
  const near = (list: Pano[]) => [...list].sort((a, b) => Math.hypot(a.pos.x - c.x, a.pos.y - c.y) - Math.hypot(b.pos.x - c.x, b.pos.y - c.y))[0] ?? null;
  const floor = panos.filter(onFloor);
  return near(floor) ?? near(panos);
}

// Where a tour starts: the living room (else family/great/dining, else the largest room). The
// tour (MatterportHost) and the sky-to-house flight (its panorama) both use this, so the flight
// ends exactly where the tour opens. `skip`: panos the tour can't visit (disabled or unaligned
// sweeps still have photos in the Model API), as reported by the tour itself.
export function entryPano(geometry: ModelGeometry, skip: ReadonlySet<string> = new Set()): Pano | null {
  const panos = geometry.panos.filter((p) => !skip.has(p.id));
  const living = [...geometry.rooms].sort((a, b) => {
    const pri = (l: string) => (/living/i.test(l) ? 2 : /family|great|dining/i.test(l) ? 1 : 0);
    return pri(b.label) - pri(a.label) || b.areaM2 - a.areaM2;
  })[0];
  return living ? panoForRoom(living, panos) : panos[0] ?? null;
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

// walls (by floor id) are optional; with them a piece that sinks into a wall's thickness is an
// error even while its centre line stays inside the room outline (which runs mid-wall).
export function checkFit(inputs: FitInput[], rooms: Room[], doors: DoorMark[] = [], walls: Record<string, Wall[]> = {}): FitIssue[] {
  const issues: FitIssue[] = [];
  const add = (uid: string, level: FitLevel, message: string) => issues.push({ uid, level, message });

  const roomOf = (item: PlacedItem) => (item.roomId && rooms.find((r) => r.id === item.roomId)) || roomAt(item.pos, rooms);
  // A pot on a table or counter stands above the floor: it does not collide with floor pieces.
  const raised = (item: PlacedItem) => {
    const r = roomOf(item);
    return !!r && item.pos.z - r.floorZ > 0.3;
  };
  const floorItems = inputs.filter((i) => i.product.placement !== 'wall' && !raised(i.item));
  for (const { item, product } of inputs) {
    const room = roomOf(item);
    if (!room) {
      if (product.placement !== 'outdoor') add(item.uid, 'error', 'Not inside a room');
      continue;
    }
    const hM = product.dimsCm.h / 100;
    if (room.heightM && product.placement !== 'wall' && hM > room.heightM) {
      add(item.uid, 'error', `Taller than the ceiling (${cm(hM)} vs ${cm(room.heightM)})`);
    }
    if (product.placement === 'wall') continue;

    const corners = footprint(item, product);
    const outside = corners.filter((c) => !pointInPolygon(c, room.polygon)).length;
    if (outside > 0) add(item.uid, 'error', `Crosses a wall of the ${room.label.toLowerCase()}`);
    else if ((walls[room.floorId] ?? []).some((w) => convexSeparation(corners, wallRect(w)) < -FIT_RULES.wallTolerance)) {
      add(item.uid, 'error', 'Goes into a wall');
    }

    for (const door of doors.filter((d) => d.roomId === room.id)) {
      // Room to walk through: a door's swing, or half a wide opening plus a step.
      const r = Math.max(door.widthM / 2 + 0.3, FIT_RULES.doorClear);
      const near = corners.some((c) => Math.hypot(c.x - door.pos.x, c.y - door.pos.y) < r) ||
        Math.hypot(item.pos.x - door.pos.x, item.pos.y - door.pos.y) < r;
      if (near) add(item.uid, 'warn', 'Blocks a doorway');
    }
  }

  for (let i = 0; i < floorItems.length; i++) {
    for (let j = i + 1; j < floorItems.length; j++) {
      const a = floorItems[i];
      const b = floorItems[j];
      if (NO_OVERLAP_CHECK.includes(a.product.category) || NO_OVERLAP_CHECK.includes(b.product.category)) continue;
      // A wall sits between items in different rooms, so there is no shared walkway to check.
      if (roomOf(a.item)?.id !== roomOf(b.item)?.id) continue;
      const sep = convexSeparation(footprint(a.item, a.product), footprint(b.item, b.product));
      if (sep > FIT_RULES.walkwayMin + 0.5) continue;
      const comp = companions(a.product.category, b.product.category);
      // Chairs tuck under a table, and a mattress lies on its bed frame: those may overlap.
      const pair = (x: Category[], y: Category[]) => (x.includes(a.product.category) && y.includes(b.product.category)) || (x.includes(b.product.category) && y.includes(a.product.category));
      if (pair(['mattress'], ['bed'])) continue;
      const tuck = pair(['dining-table', 'round-table', 'desk', 'patio-table'], ['dining-chair', 'office-chair', 'bar-stool', 'patio-chair']) ? FIT_RULES.chairTuck : FIT_RULES.overlapTolerance;
      if (sep < -tuck) {
        add(a.item.uid, 'error', `Overlaps ${b.product.name.split(',')[0]}`);
        add(b.item.uid, 'error', `Overlaps ${a.product.name.split(',')[0]}`);
      } else if (comp) {
        const seatTable =
          (SEATING.includes(a.product.category) && b.product.category === 'coffee-table') ||
          (SEATING.includes(b.product.category) && a.product.category === 'coffee-table');
        if (seatTable && sep < FIT_RULES.companionMin) {
          const msg = `Only ${cm(Math.max(sep, 0))} between seat and coffee table (aim for 35–45 cm)`;
          add(a.item.uid, 'warn', msg);
          add(b.item.uid, 'warn', msg);
        }
      } else if (sep > FIT_RULES.touchingTolerance && sep < FIT_RULES.walkwayMin) {
        const msg = `Walkway is ${cm(sep)} (needs ${cm(FIT_RULES.walkwayMin)})`;
        add(a.item.uid, 'warn', msg);
        add(b.item.uid, 'warn', msg);
      }
    }
  }
  return dedupe(issues);
}

function dedupe(issues: FitIssue[]): FitIssue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const k = i.uid + i.message;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function levelFor(uid: string, issues: FitIssue[]): FitLevel {
  const mine = issues.filter((i) => i.uid === uid);
  if (mine.some((i) => i.level === 'error')) return 'error';
  if (mine.some((i) => i.level === 'warn')) return 'warn';
  return 'ok';
}

// Whether a product's footprint can fit in a room at all, in either orientation.
export function productFitsRoom(product: Product, room: Room | null): boolean {
  if (!room || product.placement === 'wall') return true;
  const xs = room.polygon.map((p) => p.x);
  const ys = room.polygon.map((p) => p.y);
  const W = Math.max(room.widthM || 0, Math.max(...xs) - Math.min(...xs) > 0 ? Math.min(Math.max(...xs) - Math.min(...xs), room.widthM || Infinity) : 0);
  const D = Math.max(room.depthM || 0, Math.max(...ys) - Math.min(...ys) > 0 ? Math.min(Math.max(...ys) - Math.min(...ys), room.depthM || Infinity) : 0);
  const w = product.dimsCm.w / 100;
  const d = product.dimsCm.d / 100;
  const tallOk = !room.heightM || product.dimsCm.h / 100 <= room.heightM;
  return tallOk && ((w <= W && d <= D) || (w <= D && d <= W));
}

// Outdoor planner: the parcel acts as the room, and building footprints are obstacles.
export function checkOutdoor(inputs: FitInput[], parcel: Vec2[], buildings: Vec2[][]): FitIssue[] {
  const yard: Room = { id: 'parcel', label: 'Lot', floorId: '', polygon: parcel, areaM2: 0, widthM: 0, depthM: 0, heightM: null, floorZ: 0 };
  const issues = checkFit(
    inputs.map((i) => ({ ...i, item: { ...i.item, roomId: 'parcel' } })),
    [yard],
  ).map((i) => (i.message.startsWith('Crosses a wall') ? { ...i, message: 'Crosses the property line' } : i));
  for (const { item, product } of inputs) {
    if (product.category === 'umbrella') continue;
    const fp = footprint(item, product);
    const onHouse = buildings.some((b) => fp.some((c) => pointInPolygon(c, b)) || b.some((c) => pointInPolygon(c, fp)) || pointInPolygon(item.pos, b));
    if (onHouse) issues.push({ uid: item.uid, level: 'error', message: 'Sits on a building' });
  }
  return dedupe(issues);
}
