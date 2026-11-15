import { pointInPolygon, segmentsOfPolygon } from './geometry';
import type { DoorMark, Pano, Room, Vec2 } from './types';

// Rooms that open off a bedroom or living room but are not furnished: their door has to stay clear.
const SERVICE = /closet|pantry|laundry|storage|utility|mechanical/i;

const unit = (a: Vec2, b: Vec2) => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l, len: l };
};

// The stretch of the wall a-b that room `other` also runs along (outlines run mid-wall, so two
// rooms' lines are a wall's thickness apart at most), as distances from a, or null.
export function sharedSpan(a: Vec2, b: Vec2, other: Room): { lo: number; hi: number } | null {
  const e = unit(a, b);
  if (e.len < 0.4) return null;
  let best: { lo: number; hi: number } | null = null;
  for (let j = 0; j < other.polygon.length; j++) {
    const f1 = other.polygon[j];
    const f2 = other.polygon[(j + 1) % other.polygon.length];
    const f = unit(f1, f2);
    if (Math.abs(e.x * f.y - e.y * f.x) > 0.2) continue; // not parallel
    const off = Math.abs((f1.x - a.x) * -e.y + (f1.y - a.y) * e.x);
    if (off > 0.45) continue;
    const p1 = (f1.x - a.x) * e.x + (f1.y - a.y) * e.y;
    const p2 = (f2.x - a.x) * e.x + (f2.y - a.y) * e.y;
    const lo = Math.max(0, Math.min(p1, p2));
    const hi = Math.min(e.len, Math.max(p1, p2));
    if (hi - lo >= 0.4 && (!best || hi - lo > best.hi - best.lo)) best = { lo, hi };
  }
  return best;
}

// Whether the wall a-b of `room` is an interior wall: another room shares at least 60 cm of it.
// Exterior walls are where windows and glass doors are, which the scan cannot always show.
export function isInteriorWall(a: Vec2, b: Vec2, room: Room, rooms: Room[]): boolean {
  return rooms.some((o) => o.id !== room.id && o.floorId === room.floorId && (sharedSpan(a, b, o)?.hi ?? 0) - (sharedSpan(a, b, o)?.lo ?? 0) >= 0.6);
}

// The openings a room has onto closets, pantries and the like, found where their outlines run
// along the same wall. Each is returned as a door (the middle of the shared wall, as wide as the
// shared stretch), so the layout keeps furniture and hung pieces off it and leaves a way in.
export function closetOpenings(room: Room, rooms: Room[]): DoorMark[] {
  const out: DoorMark[] = [];
  const poly = room.polygon;
  for (const other of rooms) {
    if (other.id === room.id || other.floorId !== room.floorId || !SERVICE.test(other.label)) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const span = sharedSpan(a, b, other);
      if (!span) continue;
      const e = unit(a, b);
      const mid = (span.lo + span.hi) / 2;
      out.push({ uid: `closet-${other.id}-${i}`, roomId: room.id, pos: { x: a.x + e.x * mid, y: a.y + e.y * mid }, widthM: span.hi - span.lo });
    }
  }
  return out;
}

// Where two segments cross, or null.
function crossing(p: Vec2, q: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - p.x) * s.y - (c.y - p.y) * s.x) / den;
  const u = ((c.x - p.x) * r.y - (c.y - p.y) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p.x + r.x * t, y: p.y + r.y * t } : null;
}

// Doorways found from the tour itself: two panos that can see each other from different rooms see
// through a doorway, so the point where their line leaves this room is one. This finds doors the
// scan's mesh hides (an open door leaf looks like wall). Each is returned as a 90 cm door.
export function linkDoors(room: Room, rooms: Room[], panos: Pano[], links: [string, string][]): DoorMark[] {
  const at = new Map(panos.map((p) => [p.id, p]));
  const roomOf = (p: Pano) => rooms.find((r) => r.floorId === room.floorId && pointInPolygon(p.pos, r.polygon));
  const out: DoorMark[] = [];
  for (const [a, b] of links) {
    const pa = at.get(a);
    const pb = at.get(b);
    if (!pa || !pb) continue;
    const ra = roomOf(pa);
    const rb = roomOf(pb);
    if (!ra || !rb || ra.id === rb.id || (ra.id !== room.id && rb.id !== room.id)) continue;
    const [inside, outside] = ra.id === room.id ? [pa, pb] : [pb, pa];
    for (const [c, d] of segmentsOfPolygon(room.polygon)) {
      const hit = crossing(inside.pos, outside.pos, c, d);
      if (hit && !out.some((o) => Math.hypot(o.pos.x - hit.x, o.pos.y - hit.y) < 0.6)) out.push({ uid: `link-${a}-${b}`, roomId: room.id, pos: hit, widthM: 0.9 });
    }
  }
  return out;
}
