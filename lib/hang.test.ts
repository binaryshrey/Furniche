import { describe, expect, it } from 'vitest';
import { hangLift, pictureUrl } from './hang';

const wall = (h: number) => ({ dimsCm: { w: 60, d: 3, h }, placement: 'wall' as const });

describe('hangLift', () => {
  it('leaves floor pieces on the floor', () => {
    expect(hangLift({ dimsCm: { w: 60, d: 60, h: 80 }, placement: 'floor' })).toBe(0);
  });
  it('hangs art with its middle near eye level, clear of a sofa back', () => {
    expect(hangLift(wall(70))).toBeCloseTo(1.1, 2); // 1.45 - 0.35
    expect(hangLift(wall(140))).toBeCloseTo(0.95, 2); // never lower than 0.95
    expect(hangLift(wall(30))).toBeCloseTo(1.2, 2); // never higher than 1.2
  });
  it('leans a full-length mirror just off the floor', () => {
    expect(hangLift(wall(170))).toBeCloseTo(0.04, 2);
  });
});

describe('pictureUrl', () => {
  it('serves wall pieces through the image proxy and ignores the rest', () => {
    const u = 'https://www.ikea.com/us/en/images/products/x__1_pe2_s5.jpg';
    expect(pictureUrl({ placement: 'wall', cutoutUrl: u })).toBe(`/api/product-image?src=${encodeURIComponent(u)}`);
    expect(pictureUrl({ placement: 'floor', cutoutUrl: u })).toBeUndefined();
    expect(pictureUrl({ placement: 'wall' })).toBeUndefined();
  });
});
