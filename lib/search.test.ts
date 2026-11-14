import { describe as group, expect, it } from 'vitest';
import { describe, parseQuery, search, unitBeds } from './search';
import type { Listing } from './types';

group('parseQuery', () => {
  it('reads beds, rent and kind', () => {
    expect(parseQuery('3 bed apartments under $4,000')).toMatchObject({ kind: 'apartment', bedsMin: 3, bedsMax: 3, priceMax: 4000 });
  });
  it('treats N+ as a minimum and k/m suffixes as amounts', () => {
    expect(parseQuery('2+ br under 3.5k')).toMatchObject({ kind: 'apartment', bedsMin: 2, bedsMax: null, priceMax: 3500 });
    expect(parseQuery('homes under $1.2m')).toMatchObject({ kind: 'home', priceMax: 1_200_000 });
  });
  it('infers sale vs rent from the price when no kind word is given', () => {
    expect(parseQuery('3 bedrooms under 900k').kind).toBe('home');
    expect(parseQuery('1 bd below 2500').kind).toBe('apartment');
  });
  it('handles studios, ranges and places', () => {
    expect(parseQuery('studio in montrose under 2000')).toMatchObject({ bedsMin: 0, bedsMax: 0, place: 'montrose', priceMax: 2000 });
    expect(parseQuery('apartments between 2k and 3k')).toMatchObject({ priceMin: 2000, priceMax: 3000 });
  });
  it('does not read the bedroom count as a minimum price', () => {
    expect(parseQuery('at least 3 bedrooms').priceMin).toBeNull();
  });
});

group('unitBeds', () => {
  it('parses common unit names', () => {
    expect(unitBeds('2BR, 2BA - 830SF')).toBe(2);
    expect(unitBeds('1BD, 1BA - 745SF')).toBe(1);
    expect(unitBeds('Unit 201 Studio 595sf')).toBe(0);
    expect(unitBeds('911 Broxton Ave')).toBeNull();
  });
});

group('search', () => {
  const apt = (sid: string, unitName: string, rentMin: number): Listing =>
    ({ kind: 'apartment', sid, propertyId: 1, unitName, community: 'C', address: 'A St', city: 'Los Angeles', rentMin, rentMax: rentMin, lat: 34, lon: -118, rooms: 4 }) as Listing;
  const rows = [apt('a', '3BR, 2BA', 3900), apt('b', '3BR, 2BA', 4200), apt('c', '2BR, 1BA', 2500), apt('d', '3BR', 50)];

  it('filters by beds and rent, cheapest first, ignoring bad rents', () => {
    expect(search(rows, parseQuery('3 bed apartments under $4,000')).map((r) => r.sid)).toEqual(['a']);
    expect(search(rows, parseQuery('apartments')).map((r) => r.sid)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('turns a known neighbourhood into a radius search', () => {
    const near = { ...apt('k', '1BR', 1800), lat: 29.746, lon: -95.393 } as Listing;
    expect(search([...rows, near], parseQuery('1 bed in montrose under 2000')).map((r) => r.sid)).toEqual(['k']);
  });
  it('summarises the filters in words', () => {
    expect(describe(parseQuery('3 bed apartments under $4,000'))).toBe('3 bed apartments in Houston under $4,000/mo');
  });
});
