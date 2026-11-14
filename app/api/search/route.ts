import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { structured } from '@/lib/llm';
import { describe, parseQuery, search, type SearchFilters } from '@/lib/search';
import type { Listing } from '@/lib/types';

const Filters = z.object({
  kind: z.enum(['home', 'apartment', 'any']),
  bedsMin: z.number().int().nullable(),
  bedsMax: z.number().int().nullable(),
  priceMin: z.number().nullable(),
  priceMax: z.number().nullable(),
  place: z.string().nullable(),
});

const SYSTEM = `You turn a Houston home search into filters. Apartments are rentals priced per month;
homes are for sale. "3 bed" means exactly 3 bedrooms, "3+ bed" at least 3, a studio is 0.
place is a neighbourhood, street or city word from the query, or null. Use null for anything not stated.`;

// The rule parser handles the common phrasings; Claude, when configured, catches the rest.
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 300);
  let raw: string;
  try {
    raw = await readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8');
  } catch {
    return NextResponse.json({ error: 'data/listings.json is missing. Run: python3 scripts/build_listings.py' }, { status: 500 });
  }
  const data = JSON.parse(raw) as { homes: Listing[]; apartments: Listing[] };
  const listings = [...data.homes, ...data.apartments];

  let filters: SearchFilters = parseQuery(q);
  let method: 'rules' | 'ai' = 'rules';
  if (q.trim()) {
    const ai = await structured({ system: SYSTEM, user: q, schema: Filters, effort: 'low', maxTokens: 1000 });
    if (ai) {
      filters = ai;
      method = 'ai';
    }
  }
  const results = search(listings, filters);
  return NextResponse.json({ q, filters, summary: describe(filters), method, total: results.length, results });
}
