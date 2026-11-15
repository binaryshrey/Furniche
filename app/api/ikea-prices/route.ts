import { NextResponse } from 'next/server';
import { PRODUCTS } from '@/catalog/products';
import { livePrice, type LivePrice } from '@/lib/ikeaPrice';

// Live prices for catalogue products: POST { ids: string[] } -> { prices: { [id]: LivePrice | null } }.
// Only ids from our own IKEA catalogue are looked up (never arbitrary URLs).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string'))].slice(0, 60) : [];
  const products = ids.map((id) => PRODUCTS.find((p) => p.id === id && p.retailer === 'ikea')).filter((p): p is (typeof PRODUCTS)[number] => !!p);
  const prices: Record<string, LivePrice | null> = {};
  // A few at a time.
  for (let i = 0; i < products.length; i += 4) {
    await Promise.all(products.slice(i, i + 4).map(async (p) => (prices[p.id] = await livePrice(p.id, p.url, p.name).catch(() => null))));
  }
  return NextResponse.json({ prices });
}
