import { readFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const { heicToJpeg, isHeic, shrink } = await import('./heic');

// A 96 × 64 HEIC photo, red on the left and blue on the right, made with macOS's sips.
const HALVES = new Uint8Array(readFileSync(path.join(__dirname, 'fixtures', 'halves.heic')));

describe('iPhone (HEIC) photos', () => {
  it('turns one into a smaller JPEG, on any server', async () => {
    expect(isHeic(HALVES)).toBe(true);
    const out = jpeg.decode(await heicToJpeg(HALVES, 48));
    expect([out.width, out.height]).toEqual([48, 32]);
    const at = (x: number, y: number) => [...out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 3)];
    const near = (got: number[], want: number[]) => got.every((v, i) => Math.abs(v - want[i]) < 24);
    expect(near(at(8, 16), [220, 40, 40])).toBe(true);
    expect(near(at(40, 16), [40, 60, 220])).toBe(true);
  });

  it('knows a HEIC photo from a JPEG', () => {
    expect(isHeic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(false);
  });

  it('shrinks by averaging the pixels each new one covers', () => {
    // 4 × 2: two 2 × 2 blocks, black and white, become two pixels.
    const data = new Uint8ClampedArray(4 * 2 * 4);
    for (let i = 0; i < 8; i++) data.set(i % 4 < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
    const out = shrink({ width: 4, height: 2, data }, 2);
    expect([out.width, out.height, ...out.data]).toEqual([2, 1, 0, 0, 0, 255, 255, 255, 255, 255]);
    expect(shrink({ width: 4, height: 2, data }, 8).data).toBe(data); // small enough already
  });
});
