import { describe, expect, it } from 'vitest';
import { isHeic } from './photoImage';

// iPhone photos keep their HEIC header whatever they are named; the header decides.
const box = (brand: string) => new Blob([new Uint8Array([0, 0, 0, 0x28]), brand, new Uint8Array(20)]);

describe('photo format', () => {
  it('recognises HEIC by its header, not its name', async () => {
    expect(await isHeic(box('ftypheic'))).toBe(true); // an iPhone photo
    expect(await isHeic(box('ftypmif1'))).toBe(true);
    expect(await isHeic(box('ftypavif'))).toBe(false); // AVIF: browsers read it
    expect(await isHeic(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])]))).toBe(false); // JPEG
    expect(await isHeic(new Blob([]))).toBe(false);
  });
});
