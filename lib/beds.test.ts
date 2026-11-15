import { describe, expect, it } from 'vitest';
import { bedsLabel, inBeds, parseBeds } from './beds';

describe('parseBeds', () => {
  it('reads a number, a range, a minimum and studio', () => {
    expect(parseBeds('2')).toEqual({ min: 2, max: 2 });
    expect(parseBeds('2 beds')).toEqual({ min: 2, max: 2 });
    expect(parseBeds('2-3')).toEqual({ min: 2, max: 3 });
    expect(parseBeds('3 to 2')).toEqual({ min: 2, max: 3 });
    expect(parseBeds('3+')).toEqual({ min: 3, max: null });
    expect(parseBeds('3+ bd')).toEqual({ min: 3, max: null });
    expect(parseBeds('Studio')).toEqual({ min: 0, max: 0 });
  });
  it('returns null for empty or unclear text', () => {
    expect(parseBeds('')).toBeNull();
    expect(parseBeds('abc')).toBeNull();
    expect(parseBeds('2-')).toBeNull();
  });
});

describe('inBeds', () => {
  it('filters by the range and drops unknown counts only when a range is set', () => {
    expect(inBeds(4, { min: 3, max: null })).toBe(true);
    expect(inBeds(2, { min: 3, max: null })).toBe(false);
    expect(inBeds(null, { min: 1, max: 1 })).toBe(false);
    expect(inBeds(null, null)).toBe(true);
  });
});

describe('bedsLabel', () => {
  it('names the range for the tab', () => {
    expect(bedsLabel(null)).toBe('Beds');
    expect(bedsLabel({ min: 0, max: 0 })).toBe('Studio');
    expect(bedsLabel({ min: 1, max: 1 })).toBe('1 bed');
    expect(bedsLabel({ min: 2, max: 3 })).toBe('2–3 beds');
    expect(bedsLabel({ min: 3, max: null })).toBe('3+ beds');
  });
});
