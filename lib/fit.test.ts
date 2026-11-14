import { describe, expect, it } from 'vitest';
import { checkFit, levelFor, productFitsRoom } from './fit';
import type { PlacedItem, Product, Room } from './types';

const room: Room = {
  id: 'r1',
  label: 'Living Room',
  floorId: 'f1',
  polygon: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ],
  areaM2: 12,
  widthM: 4,
  depthM: 3,
  heightM: 2.5,
  floorZ: 0,
};

const prod = (id: string, category: Product['category'], w: number, d: number, h = 80): Product => ({
  id,
  source: 'curated',
  retailer: 'ikea',
  name: id,
  url: '',
  priceUsd: 100,
  priceCheckedAt: '2026-11-14',
  category,
  dimsCm: { w, d, h },
  color: '#fff',
  styles: [],
  placement: 'floor',
  standIn: true,
});

const at = (uid: string, productId: string, x: number, y: number, rot = 0): PlacedItem => ({
  uid,
  productId,
  roomId: 'r1',
  pos: { x, y, z: 0 },
  rot,
});

describe('checkFit', () => {
  it('passes an item that sits inside the room', () => {
    const issues = checkFit([{ item: at('a', 'sofa', 2, 1), product: prod('sofa', 'sofa', 200, 90) }], [room]);
    expect(levelFor('a', issues)).toBe('ok');
  });

  it('flags an item crossing a wall', () => {
    const issues = checkFit([{ item: at('a', 'sofa', 3.5, 1), product: prod('sofa', 'sofa', 200, 90) }], [room]);
    expect(levelFor('a', issues)).toBe('error');
    expect(issues[0].message).toMatch(/Crosses a wall/);
  });

  it('flags overlapping items', () => {
    const issues = checkFit(
      [
        { item: at('a', 'shelf', 1, 1), product: prod('shelf', 'bookshelf', 80, 40) },
        { item: at('b', 'desk', 1.3, 1), product: prod('desk', 'desk', 100, 50) },
      ],
      [room],
    );
    expect(levelFor('a', issues)).toBe('error');
    expect(levelFor('b', issues)).toBe('error');
  });

  it('warns about a narrow walkway between unrelated items', () => {
    const issues = checkFit(
      [
        { item: at('a', 'shelf', 1, 1.5), product: prod('shelf', 'bookshelf', 80, 40) },
        { item: at('b', 'desk', 2.4, 1.5), product: prod('desk', 'desk', 100, 50) },
      ],
      [room],
    );
    // gap = (2.4 - 0.5) - (1 + 0.4) = 0.5 m
    expect(levelFor('a', issues)).toBe('warn');
    expect(issues.find((i) => i.uid === 'a')?.message).toMatch(/50 cm/);
  });

  it('does not apply walkway rules to a sofa and its coffee table at a normal distance', () => {
    const issues = checkFit(
      [
        { item: at('a', 'sofa', 2, 0.6), product: prod('sofa', 'sofa', 200, 90) },
        { item: at('b', 'ct', 2, 1.6), product: prod('ct', 'coffee-table', 100, 50, 45) },
      ],
      [room],
    );
    // gap = (1.6 - 0.25) - (0.6 + 0.45) = 0.30 m < 0.35 -> companion warning only
    expect(issues.every((i) => /coffee table/.test(i.message))).toBe(true);
  });

  it('flags items taller than the ceiling', () => {
    const issues = checkFit([{ item: at('a', 'w', 2, 1.5), product: prod('w', 'wardrobe', 100, 58, 260) }], [room]);
    expect(issues.some((i) => /ceiling/.test(i.message))).toBe(true);
  });

  it('respects rotation when checking walls', () => {
    // 3.6 m long sofa fits along the 4 m wall but not when rotated 90 degrees in a 3 m deep room.
    const p = prod('long', 'sofa', 360, 90);
    expect(levelFor('a', checkFit([{ item: at('a', 'long', 2, 1), product: p }], [room]))).toBe('ok');
    expect(levelFor('a', checkFit([{ item: at('a', 'long', 2, 1.5, Math.PI / 2), product: p }], [room]))).toBe('error');
  });
});

describe('productFitsRoom', () => {
  it('accepts a product that fits in either orientation and rejects one that does not', () => {
    expect(productFitsRoom(prod('ok', 'sofa', 290, 100), room)).toBe(true);
    expect(productFitsRoom(prod('big', 'sectional', 450, 200), room)).toBe(false);
  });
});
