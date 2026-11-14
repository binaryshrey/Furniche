import type { SearchResult } from '@/lib/search';

export type Spot = { key: string; lat: number; lon: number; items: SearchResult[] };

// Apartments in one building share coordinates, so the map shows one marker per building.
export function spotsOf(results: SearchResult[]): Spot[] {
  const by = new Map<string, Spot>();
  for (const r of results) {
    const key = `${r.lat.toFixed(5)},${r.lon.toFixed(5)}`;
    const spot = by.get(key) ?? { key, lat: r.lat, lon: r.lon, items: [] };
    spot.items.push(r);
    by.set(key, spot);
  }
  return [...by.values()];
}
