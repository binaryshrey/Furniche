import { kmBetween, placeNamed } from './places';
import type { Listing } from './types';

// Plain-language listing search: "3 bed apartments under $4,000", "homes under 400k in Montrose".
export type SearchFilters = {
  kind: 'home' | 'apartment' | 'any';
  bedsMin: number | null;
  bedsMax: number | null;
  priceMin: number | null; // monthly rent for apartments, sale price for homes
  priceMax: number | null;
  place: string | null; // matched against address, community and city
};

export type SearchResult = {
  sid: string;
  kind: 'home' | 'apartment';
  title: string;
  subtitle: string;
  price: number | null;
  rent: boolean; // price is per month
  priceLabel: string;
  beds: number | null;
  lat: number;
  lon: number;
};

const money = (raw: string, suffix?: string) => {
  const n = parseFloat(raw.replace(/,/g, ''));
  const s = (suffix ?? '').toLowerCase();
  return s.startsWith('m') ? n * 1_000_000 : s.startsWith('k') ? n * 1000 : n;
};
const AMOUNT = String.raw`\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|mil|million|thousand)?\b`;

export function parseQuery(q: string): SearchFilters {
  const s = q.toLowerCase();
  const f: SearchFilters = { kind: 'any', bedsMin: null, bedsMax: null, priceMin: null, priceMax: null, place: null };

  if (/\b(apartments?|apts?|rent(al)?s?|lease|studios?|per month|\/mo|monthly|units?)\b/.test(s)) f.kind = 'apartment';
  else if (/\b(houses?|homes?|buy|for sale|single[- ]family|condos?|townhomes?)\b/.test(s)) f.kind = 'home';

  if (/\bstudios?\b/.test(s)) {
    f.bedsMin = 0;
    f.bedsMax = 0;
  }
  const beds = s.match(/(\d+)\s*(\+|or more)?\s*(?:-|\s)?(?:beds?|bedrooms?|br|bd|bdrm)\b/);
  if (beds) {
    const n = Number(beds[1]);
    const atLeast = !!beds[2] || /\b(at least|min(imum)?)\s+\d+\s*(beds?|bedrooms?|br|bd)/.test(s);
    f.bedsMin = n;
    f.bedsMax = atLeast ? null : n;
  }

  const between = s.match(new RegExp(`between\\s+${AMOUNT}\\s+(?:and|-|to)\\s+${AMOUNT}`));
  if (between) {
    f.priceMin = money(between[1], between[2]);
    f.priceMax = money(between[3], between[4]);
  } else {
    const max = s.match(new RegExp(`(?:under|below|less than|max(?:imum)?|up to|within|<|budget(?: of)?)\\s*${AMOUNT}`));
    if (max) f.priceMax = money(max[1], max[2]);
    // "at least 3 bedrooms" is a bed count, not a price.
    const min = s.match(new RegExp(`(?:over|above|more than|at least|min(?:imum)?|from|>)\\s*${AMOUNT}(?!\\s*\\+?\\s*(?:beds?|bedrooms?|br|bd|bdrm)\\b)`));
    if (min) f.priceMin = money(min[1], min[2]);
  }

  // A price tells rent from sale when the words didn't.
  const p = f.priceMax ?? f.priceMin;
  if (f.kind === 'any' && p != null) f.kind = p < RENT_CEILING ? 'apartment' : 'home';

  const place = s.match(/\b(?:in|near|around|on)\s+([a-z][a-z .'-]{2,40}?)(?=\s+(?:under|below|over|above|with|for|between|max|up to|less|more|at)\b|[,.]|$)/);
  if (place) f.place = place[1].trim();
  return f;
}

// Bedrooms from apartment unit names like "2BR, 2BA - 830SF", "1BD, 1BA", "Unit 201 Studio 595sf".
export function unitBeds(unitName: string | null | undefined): number | null {
  if (!unitName) return null;
  if (/studio/i.test(unitName)) return 0;
  const m = unitName.match(/(\d+)\s*(?:BR|BD|Bed)(?![a-z])/i);
  return m ? Number(m[1]) : null;
}

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const short = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0).replace(/\.?0+$/, '')}M` : `$${Math.round(n / 1000)}k`);

export function toResult(l: Listing): SearchResult | null {
  if (l.lat == null || l.lon == null) return null;
  if (l.kind === 'home') {
    // A $1 "price" is a placeholder in the feed; a few houses are listed for rent at a monthly price.
    const price = l.price && l.price > 300 ? l.price : null;
    const rent = !!price && price < RENT_CEILING;
    return {
      sid: l.sid,
      kind: 'home',
      title: l.address,
      subtitle: [l.beds != null && `${l.beds} bd`, l.baths != null && `${l.baths} ba`, l.sqft && `${l.sqft.toLocaleString()} sq ft`].filter(Boolean).join(' · '),
      price,
      rent,
      priceLabel: !price ? 'Home' : rent ? `${usd(price)}/mo` : short(price),
      beds: l.beds,
      lat: l.lat,
      lon: l.lon,
    };
  }
  // Rents under $300 are data errors in the feed.
  const price = l.rentMin && l.rentMin >= 300 ? l.rentMin : null;
  return {
    sid: l.sid,
    kind: 'apartment',
    title: l.community ?? l.address,
    subtitle: [l.unitName, l.address].filter(Boolean).join(' · '),
    price,
    rent: true,
    priceLabel: price ? `${usd(price)}/mo` : 'Rent',
    beds: unitBeds(l.unitName),
    lat: l.lat,
    lon: l.lon,
  };
}

// Prices below this are monthly rents, above it sale prices.
const RENT_CEILING = 25_000;

export function search(listings: Listing[], f: SearchFilters): SearchResult[] {
  const place = f.place?.toLowerCase();
  const area = place ? placeNamed(place) : null;
  const bound = f.priceMax ?? f.priceMin;
  return listings
    .filter((l) => f.kind === 'any' || l.kind === f.kind)
    .filter((l) => !place || !!area || [l.address, l.city, l.kind === 'apartment' ? l.community : null].some((t) => t?.toLowerCase().includes(place)))
    .map(toResult)
    .filter((r): r is SearchResult => !!r)
    .filter((r) => !area || kmBetween(r, area) <= area.km)
    // A rent-sized budget only matches rents, a sale-sized one only sale prices.
    .filter((r) => bound == null || r.rent === bound < RENT_CEILING)
    .filter((r) => (f.bedsMin == null || (r.beds != null && r.beds >= f.bedsMin)) && (f.bedsMax == null || (r.beds != null && r.beds <= f.bedsMax)))
    .filter((r) => (f.priceMin == null || (r.price != null && r.price >= f.priceMin)) && (f.priceMax == null || (r.price != null && r.price <= f.priceMax)))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

export function describe(f: SearchFilters): string {
  const what = f.kind === 'apartment' ? 'apartments' : f.kind === 'home' ? 'homes' : 'homes and apartments';
  const beds =
    f.bedsMin === 0 && f.bedsMax === 0 ? 'Studio ' : f.bedsMin != null ? `${f.bedsMin}${f.bedsMax == null ? '+' : ''} bed ` : '';
  const per = f.kind === 'apartment' ? '/mo' : '';
  const price =
    f.priceMin != null && f.priceMax != null
      ? ` from ${usd(f.priceMin)} to ${usd(f.priceMax)}${per}`
      : f.priceMax != null
        ? ` under ${usd(f.priceMax)}${per}`
        : f.priceMin != null
          ? ` over ${usd(f.priceMin)}${per}`
          : '';
  const where = f.place ? ` in ${f.place.replace(/\b\w/g, (c) => c.toUpperCase())}` : ' in Houston';
  const text = `${beds}${what}${where}${price}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
