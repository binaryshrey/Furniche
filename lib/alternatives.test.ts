import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '@/catalog/products';
import { alternatives, swapped } from './alternatives';
import type { PlacedItem, Room } from './types';

const room: Room = {
  id: 'r',
  label: 'Living Room',
  floorId: 'f',
  polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4.5 }, { x: 0, y: 4.5 }],
  areaM2: 22.5,
  widthM: 5,
  depthM: 4.5,
  heightM: 2.6,
  floorZ: 0,
};

describe('alternatives', () => {
  it('offers up to four other sofas that fit the same spot', () => {
    const sofa = PRODUCTS.find((p) => p.category === 'sofa')!;
    // Back to the y=0 wall, facing into the room (+y).
    const item: PlacedItem = { uid: 'a', productId: sofa.id, roomId: 'r', pos: { x: 2.5, y: sofa.dimsCm.d / 200 + 0.11, z: 0 }, rot: Math.PI };
    const opts = alternatives({ item, items: [item], products: PRODUCTS, rooms: [room] });
    expect(opts.length).toBeGreaterThan(1);
    expect(opts.length).toBeLessThanOrEqual(4);
    for (const o of opts) {
      expect(['sofa', 'sectional']).toContain(o.product.category);
      expect(o.product.id).not.toBe(sofa.id);
    }
    expect(opts.filter((o) => o.fits).length).toBeGreaterThan(0);
  });

  it('keeps a wall-backed piece against the wall when the depth changes', () => {
    const a = PRODUCTS.find((p) => p.category === 'sofa')!;
    const b = { ...a, id: 'deeper', dimsCm: { ...a.dimsCm, d: a.dimsCm.d + 40 } };
    const item: PlacedItem = { uid: 'a', productId: a.id, roomId: 'r', pos: { x: 2.5, y: 1, z: 0 }, rot: Math.PI }; // faces +y
    const next = swapped(item, a, b);
    // Back edge (centre minus half depth along the facing) is unchanged.
    expect(next.pos.y - b.dimsCm.d / 200).toBeCloseTo(item.pos.y - a.dimsCm.d / 200, 5);
  });
});
