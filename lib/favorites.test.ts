import { describe, expect, it } from 'vitest';
import { FAVORITES_KEY, loadFavorites, saveFavorites } from './favorites';

const memory = (initial?: string) => {
  const data = new Map<string, string>(initial === undefined ? [] : [[FAVORITES_KEY, initial]]);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

describe('favorites', () => {
  it('starts empty and round-trips', () => {
    const store = memory();
    expect(loadFavorites(store).size).toBe(0);
    saveFavorites(new Set(['a', 'b']), store);
    expect([...loadFavorites(store)]).toEqual(['a', 'b']);
  });
  it('ignores damaged or unexpected saved text', () => {
    expect(loadFavorites(memory('not json')).size).toBe(0);
    expect(loadFavorites(memory('{"a":1}')).size).toBe(0);
    expect([...loadFavorites(memory('["a",3,null,"b"]'))]).toEqual(['a', 'b']);
  });
  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadFavorites(blocked).size).toBe(0);
    expect(() => saveFavorites(new Set(['a']), blocked)).not.toThrow();
  });
});
