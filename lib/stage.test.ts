import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '@/catalog/products';
import { furnishableType } from './autofurnish';
import { convexSeparation, distPointSegment, pointInPolygon, rectCorners } from './geometry';
import { closetNextTo, openingsFor, stageRoom } from './stage';
import type { Room, Wall } from './types';

const room = (label: string, w: number, d: number): Room => ({
  id: label,
  label,
  floorId: 'f1',
  polygon: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ],
  areaM2: w * d,
  widthM: w,
  depthM: d,
  heightM: 2.6,
  floorZ: 0,
});

// A window in the middle of the north wall (y = d), a door near the corner of the south wall.
const walls = (w: number, d: number): Wall[] => [
  { id: 's', a: { x: 0, y: 0 }, b: { x: w, y: 0 }, thickness: 0.12, openings: [{ type: 'doorway', at: 0.12, width: 0.85, sill: 0, height: 2.03 }] },
  { id: 'e', a: { x: w, y: 0 }, b: { x: w, y: d }, thickness: 0.12 },
  { id: 'n', a: { x: w, y: d }, b: { x: 0, y: d }, thickness: 0.12, openings: [{ type: 'window', at: 0.5, width: 1.5, sill: 0.85, height: 1.2 }] },
  { id: 'w', a: { x: 0, y: d }, b: { x: 0, y: 0 }, thickness: 0.12 },
];

function check(kind: 'bedroom' | 'living', w: number, d: number) {
  const r = room(kind === 'bedroom' ? 'Bedroom' : 'Living Room', w, d);
  const open = openingsFor(r, walls(w, d));
  expect(open.windows).toHaveLength(1);
  expect(open.doors).toHaveLength(1);
  const res = stageRoom(r, kind, PRODUCTS, open);
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const floor = res.placed
    .map((p) => ({ p, pr: byId.get(p.productId)! }))
    .filter(({ pr }) => pr.placement === 'floor' && pr.category !== 'rug' && pr.category !== 'mattress');
  const fp = floor.map(({ p, pr }) => rectCorners(p.pos, pr.dimsCm.w / 100, pr.dimsCm.d / 100, p.rot));
  // Inside the room, never overlapping (chairs may tuck under their table).
  fp.forEach((f) => f.forEach((c) => expect(pointInPolygon(c, r.polygon)).toBe(true)));
  for (let i = 0; i < fp.length; i++)
    for (let j = i + 1; j < fp.length; j++) {
      const cats = [floor[i].pr.category, floor[j].pr.category];
      if (cats.includes('dining-chair') && cats.some((c) => c === 'dining-table' || c === 'round-table')) continue;
      expect(convexSeparation(fp[i], fp[j])).toBeGreaterThan(0.02);
    }
  // Nothing taller than the sill in front of the window.
  const win = open.windows[0];
  floor.forEach(({ pr }, i) => {
    if (pr.dimsCm.h / 100 > 0.8) fp[i].forEach((c) => expect(distPointSegment(c, win.a, win.b)).toBeGreaterThan(0.35));
  });
  // Wall pieces hang above the floor and clear of the window's span on its wall.
  for (const p of res.placed.filter((x) => byId.get(x.productId)!.placement === 'wall')) {
    expect(p.pos.z).toBeGreaterThan(0.25);
    if (Math.abs(p.pos.y - d) < 0.3) expect(Math.abs(p.pos.x - w / 2)).toBeGreaterThan(0.75);
  }
  return res;
}

describe('stageRoom', () => {
  it('stages a full bedroom: bed, mattress, painting, lamp, closet, dressing table, mirror, TV, vase', () => {
    const res = check('bedroom', 4.6, 4.0);
    const roles = res.placed.map((p) => p.role);
    for (const r of ['bed', 'mattress', 'wall art', 'floor lamp', 'tv', 'flower vase']) expect(roles).toContain(r);
    expect(roles.some((r) => r === 'closet' || r === 'dressing table')).toBe(true);
  });

  it('stages a living room: sofa, painting, rug, TV, dining table, vase', () => {
    const res = check('living', 7.2, 4.6);
    const roles = res.placed.map((p) => p.role);
    for (const r of ['sofa', 'wall art', 'rug', 'tv', 'flower vase']) expect(roles).toContain(r);
  });

  it('leaves kitchens alone', () => {
    expect(furnishableType(room('Kitchen', 14, 5))).toBeNull();
  });

  it('never hangs a TV or painting over a closet, a window or each other', () => {
    for (const [w, d] of [[4.6, 4.0], [3.6, 3.4], [5.2, 4.4]] as const) {
      const r = room('Bedroom', w, d);
      const open = openingsFor(r, walls(w, d));
      const res = stageRoom(r, 'bedroom', PRODUCTS, open);
      const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
      const hung = res.placed.filter((p) => byId.get(p.productId)!.placement === 'wall');
      const tall = res.placed.filter((p) => byId.get(p.productId)!.placement === 'floor' && byId.get(p.productId)!.dimsCm.h > 120);
      const span = (p: (typeof res.placed)[number]) => {
        const pr = byId.get(p.productId)!;
        const half = pr.dimsCm.w / 200;
        const alongX = Math.abs(Math.sin(p.rot)) < 0.5; // faces ±y: runs along x
        const c = alongX ? p.pos.x : p.pos.y;
        return { lo: c - half, hi: c + half, line: alongX ? Math.round(p.pos.y * 2) : Math.round(p.pos.x * 2) + 1000, z0: p.pos.z, z1: p.pos.z + pr.dimsCm.h / 100 };
      };
      for (let i = 0; i < hung.length; i++)
        for (let j = i + 1; j < hung.length; j++) {
          const [a, b] = [span(hung[i]), span(hung[j])];
          if (a.line !== b.line) continue;
          const overlap = a.lo < b.hi && b.lo < a.hi && a.z0 < b.z1 && b.z0 < a.z1;
          expect(overlap).toBe(false);
        }
      for (const h of hung)
        for (const t of tall) {
          const [a, b] = [span(h), span(t)];
          if (Math.abs(a.line - b.line) > 2) continue;
          expect(a.lo < b.hi && b.lo < a.hi).toBe(false);
        }
    }
  });

  it('picks a TV size that suits the wall', () => {
    const big = stageRoom(room('Living Room', 8, 5.5), 'living', PRODUCTS, openingsFor(room('Living Room', 8, 5.5), walls(8, 5.5)));
    const small = stageRoom(room('Bedroom', 3.4, 3.2), 'bedroom', PRODUCTS, openingsFor(room('Bedroom', 3.4, 3.2), walls(3.4, 3.2)));
    const tvW = (r: typeof big) => PRODUCTS.find((p) => p.id === r.placed.find((x) => x.role === 'tv')?.productId)?.dimsCm.w ?? 0;
    expect(tvW(big)).toBeGreaterThan(0);
    expect(tvW(small)).toBeLessThanOrEqual(tvW(big));
  });

  it('adds no closet when the bedroom already has one', () => {
    const bed = room('Bedroom', 4.6, 4.0);
    const closet: Room = { ...room('Closet', 1.2, 2.0), id: 'c', polygon: [{ x: 4.6, y: 0 }, { x: 5.8, y: 0 }, { x: 5.8, y: 2 }, { x: 4.6, y: 2 }] };
    expect(closetNextTo(bed, [bed, closet])).toBe(true);
    const res = stageRoom(bed, 'bedroom', PRODUCTS, openingsFor(bed, walls(4.6, 4.0)), [], undefined, { hasCloset: true });
    expect(res.placed.some((p) => p.role === 'closet')).toBe(false);
  });
});
