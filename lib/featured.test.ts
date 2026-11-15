import { describe, expect, it } from 'vitest';
import { FEATURED, featuredOnTop, withFeatured } from './featured';
import type { SearchResult } from './search';

const r = (sid: string): SearchResult => ({ sid, kind: 'apartment', listingId: null, title: sid, subtitle: '', price: 1, rent: true, priceLabel: '$1/mo', beds: 1, lat: 0, lon: 0 });
const list = Array.from({ length: 10 }, (_, i) => r(`s${i}`));

describe('withFeatured', () => {
  it('puts the featured home in 6th place', () => {
    const out = withFeatured(list, r(FEATURED.sid));
    expect(out).toHaveLength(11);
    expect(out[5].sid).toBe(FEATURED.sid);
    expect(out.slice(0, 5).map((x) => x.sid)).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });
  it('moves it there if it is already in the list, never twice', () => {
    const out = withFeatured([...list.slice(0, 2), r(FEATURED.sid), ...list.slice(2)], r(FEATURED.sid));
    expect(out.filter((x) => x.sid === FEATURED.sid)).toHaveLength(1);
    expect(out[5].sid).toBe(FEATURED.sid);
  });
  it('goes last in a short list and leaves a list alone without it', () => {
    expect(withFeatured(list.slice(0, 3), r(FEATURED.sid)).map((x) => x.sid)).toEqual(['s0', 's1', 's2', FEATURED.sid]);
    expect(withFeatured(list, null)).toBe(list);
  });
});

describe('featuredOnTop', () => {
  it('draws the featured pin last', () => {
    const pins = [{ sid: 'a' }, { sid: FEATURED.sid }, { sid: 'b' }];
    expect(featuredOnTop(pins).map((p) => p.sid)).toEqual(['a', 'b', FEATURED.sid]);
  });
});
