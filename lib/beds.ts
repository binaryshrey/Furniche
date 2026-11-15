// The Beds tab's text box: what was typed, and what it means.

// null means "any number of bedrooms" (the box is empty or the text is not understood).
export type BedRange = { min: number; max: number | null } | null;
export type BedFilter = { text: string; range: BedRange };
export const NO_BEDS: BedFilter = { text: '', range: null };

// "2" → exactly 2, "2-3" / "2 to 3" → 2 to 3, "3+" → 3 or more, "studio" / "studios" → 0.
// "bed", "beds", "bd", "br" and "bedroom(s)" are ignored, so "2 beds" works too.
export function parseBeds(text: string): BedRange {
  const s = text
    .toLowerCase()
    .replace(/\b(bedrooms?|beds?|bd|br)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (s === 'studio' || s === 'studios') return { min: 0, max: 0 };
  let m = s.match(/^(\d+)\s*\+$/);
  if (m) return { min: Number(m[1]), max: null };
  m = s.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  m = s.match(/^(\d+)$/);
  if (m) return { min: Number(m[1]), max: Number(m[1]) };
  return null;
}

// Listings with an unknown bedroom count drop out as soon as a range is set.
export function inBeds(beds: number | null, r: BedRange) {
  if (!r) return true;
  if (beds == null) return false;
  return beds >= r.min && (r.max == null || beds <= r.max);
}

export function bedsLabel(r: BedRange) {
  if (!r) return 'Beds';
  if (r.min === 0 && r.max === 0) return 'Studio';
  if (r.max == null) return `${r.min}+ beds`;
  if (r.min === r.max) return `${r.min} bed${r.min === 1 ? '' : 's'}`;
  return `${r.min}–${r.max} beds`;
}
