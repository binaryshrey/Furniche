import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '@/catalog/products';
import { extentsAt, knownAxis, scaledDims, squareAngle, typicalCm } from './photoSize';
import type { Product } from './types';

// A chair as image-to-3D returns it: normalised, wider than deep, taller than wide.
const chair = { x: 0.62, y: 1, z: 0.7 };

// The 8 corners of a w × h × d box centred on the origin, turned by `yaw` (three.js rotation.y),
// plus some points inside it.
function box(w: number, h: number, d: number, yaw = 0): number[] {
  const pts: number[] = [];
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  for (const x of [-w / 2, w / 2, 0]) for (const y of [0, h]) for (const z of [-d / 2, d / 2, d / 4]) pts.push(x * c + z * s, y, -x * s + z * c);
  return pts;
}

describe('photo model sizing', () => {
  it('scales every side by one known measurement, keeping the shape', () => {
    expect(scaledDims(chair, 'h', 80)).toEqual({ w: 50, d: 56, h: 80 });
    const fromWidth = scaledDims(chair, 'w', 62);
    expect(fromWidth).toEqual({ w: 62, d: 70, h: 100 });
    expect(fromWidth.d / fromWidth.w).toBeCloseTo(chair.z / chair.x, 2);
  });

  it('measures the model at any turn', () => {
    const pts = box(2, 1, 1);
    expect(extentsAt(pts, 0)).toEqual({ x: 2, y: 1, z: 1 });
    const quarter = extentsAt(pts, Math.PI / 2);
    expect([quarter.x, quarter.y, quarter.z].map((v) => +v.toFixed(6))).toEqual([1, 1, 2]);
    // At 45° the footprint of a 2 × 1 box is 3/√2 on each side.
    const diag = extentsAt(pts, Math.PI / 4);
    expect(diag.x).toBeCloseTo(3 / Math.SQRT2, 6);
    expect(diag.z).toBeCloseTo(3 / Math.SQRT2, 6);
    expect(extentsAt([], 0)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('squares up a piece that was photographed at an angle', () => {
    for (const deg of [30, -20, 10, 44]) {
      const turnedBy = (deg * Math.PI) / 180;
      const pts = box(1.2, 0.8, 0.6, turnedBy);
      const fix = squareAngle(pts);
      expect(Math.abs(fix + turnedBy)).toBeLessThan(1e-6); // undoes the turn, within ±45°
      const e = extentsAt(pts, fix);
      expect(e.x).toBeCloseTo(1.2, 6);
      expect(e.z).toBeCloseTo(0.6, 6);
    }
    // Already square: no turn.
    expect(Math.abs(squareAngle(box(1, 1, 0.5)))).toBeLessThan(1e-9);
    // Too few points to say: no turn.
    expect(squareAngle([0, 0, 0, 1, 0, 0])).toBe(0);
  });

  it('never returns a zero side for very flat pieces', () => {
    const rug = { x: 1, y: 0.004, z: 0.66 };
    expect(knownAxis('rug')).toBe('w');
    expect(scaledDims(rug, knownAxis('rug'), 200)).toEqual({ w: 200, d: 132, h: 1 });
  });

  it('starts from the middle catalogue size of the same kind of piece', () => {
    const heights = PRODUCTS.filter((p) => p.category === 'armchair').map((p) => p.dimsCm.h).sort((a, b) => a - b);
    expect(typicalCm('armchair', 'h', PRODUCTS)).toBe(heights[Math.floor(heights.length / 2)]);
    // Only curated products count: a photo piece must not shift the estimate.
    const odd: Product = { ...PRODUCTS.find((p) => p.category === 'armchair')!, id: 'photo-x', source: 'photo', dimsCm: { w: 1, d: 1, h: 1 } };
    expect(typicalCm('armchair', 'h', [...PRODUCTS, odd, odd, odd, odd, odd])).toBe(typicalCm('armchair', 'h', PRODUCTS));
    expect(typicalCm('armchair', 'h', [])).toBe(80);
  });
});
