import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '@/catalog/products';
import { autoFurnish, furnishableType } from './autofurnish';
import { checkFlow, flowContext, reachableTargets } from './circulation';
import { checkFit } from './fit';
import { flowClear } from './solver';
import type { Room } from './types';

const rect = (label: string, w: number, d: number): Room => ({
  id: label,
  label,
  floorId: 'f',
  polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }],
  areaM2: w * d,
  widthM: w,
  depthM: d,
  heightM: 2.6,
  floorZ: 0,
});

describe('furnishableType', () => {
  it('furnishes living spaces and skips service rooms', () => {
    expect(furnishableType(rect('Living Room', 5, 4))).toBe('living');
    expect(furnishableType(rect('Primary Bedroom', 4, 4))).toBe('bedroom');
    expect(furnishableType(rect('Bathroom', 2, 3))).toBeNull();
    expect(furnishableType(rect('Hallway', 1.2, 5))).toBeNull();
    expect(furnishableType(rect('Kitchen', 4, 4))).toBeNull();
  });
});

describe('autoFurnish', () => {
  for (const [label, w, d] of [['Living Room', 5, 4.2], ['Bedroom', 3.6, 3.4], ['Dining Room', 3.6, 3.2], ['Office', 3, 2.8]] as const) {
    it(`gives a ${label} a layout with no fit errors`, () => {
      const room = rect(label, w, d);
      const r = autoFurnish(room, PRODUCTS)!;
      expect(r.placed.length).toBeGreaterThan(1);
      const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
      const issues = checkFit(r.placed.map((p, i) => ({ item: { ...p, uid: String(i) }, product: byId.get(p.productId)! })), [room]);
      expect(issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(r.spent).toBeLessThanOrEqual(r.budget * 1.1);
    });
  }
  it('keeps a tiny room to the essentials', () => {
    const r = autoFurnish(rect('Bedroom', 3, 2.7), PRODUCTS)!;
    expect(r.placed.map((p) => p.role)).toContain('bed');
    expect(r.placed.length).toBeLessThanOrEqual(4);
  });
});

describe('circulation', () => {
  const panos = (pts: [number, number][]) => pts.map(([x, y], i) => ({ id: String(i), label: String(i), floorId: 'f', pos: { x, y, z: 1.5 } }));

  it('never places floor lamps', () => {
    for (const [label, w, d] of [['Living Room', 6, 5], ['Bedroom', 4.5, 4], ['Office', 3.5, 3]] as const) {
      const r = autoFurnish(rect(label, w, d), PRODUCTS)!;
      expect(r.placed.map((p) => p.role)).not.toContain('floor lamp');
    }
  });

  it('keeps every spot people walked through reachable', () => {
    const room = rect('Living Room', 5, 4.2);
    const hall = { ...rect('Hallway', 1.2, 4.2), polygon: [{ x: 5, y: 0 }, { x: 6.2, y: 0 }, { x: 6.2, y: 4.2 }, { x: 5, y: 4.2 }] };
    // One mid-room, one just inside the doorway to the hall, one in the hall.
    const ps = panos([[2.5, 2.1], [4.5, 0.6], [5.6, 2]]);
    const r = autoFurnish(room, PRODUCTS, { rooms: [room, hall], panos: ps })!;
    const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
    const ctx = reachableTargets(room, flowContext(room, [room, hall], ps));
    expect(ctx.stand).toHaveLength(1);
    expect(ctx.shared).toHaveLength(1);
    expect(r.placed.map((p) => p.role)).toContain('coffee table');
    expect(flowClear(room, r.placed, byId, ctx)).toBe(true);
  });

  it('notices a piece that walls off part of the room', () => {
    const room = rect('Living Room', 5, 4);
    const ctx = reachableTargets(room, flowContext(room, [room], panos([[0.6, 2], [4.4, 2]]), [{ x: 0.3, y: 2 }, { x: 4.7, y: 2 }]));
    expect(ctx.stand).toHaveLength(2);
    const wall = [{ x: 2, y: -1 }, { x: 3, y: -1 }, { x: 3, y: 5 }, { x: 2, y: 5 }];
    expect(checkFlow(room, [wall], ctx).ok).toBe(false);
    expect(checkFlow(room, [], ctx).ok).toBe(true);
  });
});

describe('open-plan dining room', () => {
  // The Sharpstown Garden dining room (29 m²): an L whose centroid falls on the inner corner.
  const poly = [[5.64, -0.46], [5.64, -1.89], [5.33, -1.88], [3.21, -1.88], [3.2, -4.46], [-1.15, -4.45], [-1.14, 0.96], [3.16, 0.96], [5.64, 0.95]];
  const room: Room = {
    id: 'dining',
    label: 'Dining Room',
    floorId: 'f',
    polygon: poly.map(([x, y]) => ({ x, y })),
    areaM2: 29.2,
    widthM: 6.6,
    depthM: 5.2,
    heightM: 2.39,
    floorZ: 0,
  };

  it('gets a dining set and a lounge, not a lone table', () => {
    const r = autoFurnish(room, PRODUCTS)!;
    const roles = r.placed.map((p) => p.role);
    expect(roles).toContain('dining table');
    expect(roles.filter((x) => x === 'dining chair').length).toBeGreaterThanOrEqual(4);
    expect(roles).toContain('sofa');
    expect(roles).toContain('tv console');
    expect(roles).toContain('rug');
  });
});

describe('occupied rooms: mirrors and art on the walls', () => {
  it('hangs art over the sofa and a mirror and art in a bedroom', () => {
    const living = autoFurnish(rect('Living Room', 5.5, 4.5), PRODUCTS)!;
    expect(living.placed.map((p) => p.role)).toContain('wall art');
    const bed = autoFurnish(rect('Bedroom', 4.2, 3.8), PRODUCTS)!;
    const roles = bed.placed.map((p) => p.role);
    expect(roles).toContain('wall art');
    expect(roles).toContain('mirror');
  });

  it('keeps hung pieces on a wall and clear of the floor checks', () => {
    const room = rect('Bedroom', 4.2, 3.8);
    const r = autoFurnish(room, PRODUCTS)!;
    const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
    for (const p of r.placed.filter((x) => byId.get(x.productId)!.placement === 'wall')) {
      const nearest = Math.min(p.pos.x, room.widthM - p.pos.x, p.pos.y, room.depthM - p.pos.y);
      expect(nearest).toBeLessThan(0.3); // a hand's width off a wall
    }
    expect(checkFit(r.placed.map((p, i) => ({ item: { ...p, uid: String(i) }, product: byId.get(p.productId)! })), [room]).filter((i) => i.level === 'error')).toEqual([]);
  });
});
