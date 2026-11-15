import type { SearchResult } from './search';

// The home the landing page features (the banner photo, a pin on top of the 3D city, and a
// fixed spot in the list).
export const FEATURED = { sid: '6dgWVBzerB7', label: '1623 Fawnhope Drive, Houston' };

// Zero-based list position: the 6th card.
export const FEATURED_PLACE = 5;

// The results with the featured home at its place (or last, if there are fewer). Any other copy of
// it in the list is dropped first, so it never appears twice.
export function withFeatured(results: SearchResult[], featured: SearchResult | null, place = FEATURED_PLACE): SearchResult[] {
  if (!featured) return results;
  const rest = results.filter((r) => r.sid !== featured.sid);
  rest.splice(Math.min(place, rest.length), 0, featured);
  return rest;
}

// Map pins in drawing order: the featured home last, so its pin sits on top of its neighbours.
export function featuredOnTop<T extends { sid: string }>(pins: T[]): T[] {
  return [...pins.filter((p) => p.sid !== FEATURED.sid), ...pins.filter((p) => p.sid === FEATURED.sid)];
}
