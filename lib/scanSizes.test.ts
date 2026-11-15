import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_LABEL } from '@/catalog/products';
import { SCAN_KINDS, SCAN_PROMPTS } from './scanSizes';

describe('what a scan can be, and its usual size', () => {
  it('lists each kind once, with a real type and a size', () => {
    expect(new Set(SCAN_KINDS.map((k) => k.name)).size).toBe(SCAN_KINDS.length);
    for (const k of SCAN_KINDS) {
      expect(CATEGORY_LABEL[k.category], k.name).toBeTruthy();
      expect(Math.min(k.w, k.d, k.h), k.name).toBeGreaterThan(0);
      expect(Math.max(k.w, k.d, k.h), k.name).toBeLessThan(400);
    }
  });

  it('ships the kinds worked out for the browser, matching this list', () => {
    // When this fails, recognition still works, but each browser first downloads 170 MB to
    // work the list out: regenerate public/photo3d/kinds.json (see lib/recognize.ts).
    const shipped = JSON.parse(readFileSync(path.join(__dirname, '..', 'public', 'photo3d', 'kinds.json'), 'utf8'));
    expect(shipped.names).toEqual(SCAN_KINDS.map((k) => k.name));
    expect(shipped.prompts).toEqual(SCAN_PROMPTS);
    expect(Buffer.from(shipped.vectors, 'base64').length).toBe(SCAN_KINDS.length * shipped.dim);
  });
});
