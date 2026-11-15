import 'server-only';

// Live IKEA prices. Each product page carries schema.org Offer data (price, currency,
// availability); if a catalogue item has no product page, IKEA's own search finds it by name.
// Results are kept for 30 minutes so a busy demo doesn't hammer ikea.com.

export type LivePrice = { price: number; currency: string; inStock: boolean | null; url: string; checkedAt: string };

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PRODUCT_PAGE = /^https:\/\/www\.ikea\.com\/[a-z]{2}\/[a-z]{2}\/p\/[a-z0-9-]+\/?$/i;
const TTL = 30 * 60 * 1000;
const g = globalThis as unknown as { __fnPrices?: Map<string, { at: number; v: LivePrice | null }> };
const cache = (g.__fnPrices ??= new Map());

async function get(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  return res?.ok ? res.text() : null;
}

// The Offer in the page's JSON-LD.
export function priceFromPage(html: string): { price: number; currency: string; inStock: boolean | null } | null {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(m[1]);
      for (const node of Array.isArray(j) ? j : [j]) {
        const offers = node?.offers;
        const o = Array.isArray(offers) ? offers[0] : offers;
        const price = Number(o?.price ?? o?.lowPrice);
        if (o && Number.isFinite(price) && price > 0) {
          const av = String(o.availability ?? '');
          return { price, currency: String(o.priceCurrency ?? 'USD'), inStock: av ? /InStock|LimitedAvailability/i.test(av) : null };
        }
      }
    } catch {
      /* not JSON we understand */
    }
  }
  return null;
}

async function fromSearch(name: string): Promise<LivePrice | null> {
  const q = encodeURIComponent(name.replace(/,/g, ' ').slice(0, 100));
  const body = await get(`https://sik.search.blue.cdtapps.com/us/en/search-result-page?q=${q}&size=1&types=PRODUCT`);
  try {
    const p = body ? JSON.parse(body).searchResultPage?.products?.main?.items?.[0]?.product : null;
    const price = Number(p?.salesPrice?.numeral);
    if (!p?.pipUrl || !PRODUCT_PAGE.test(p.pipUrl) || !(price > 0)) return null;
    return { price, currency: p.salesPrice.currencyCode ?? 'USD', inStock: null, url: p.pipUrl, checkedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

export async function livePrice(id: string, url: string, name: string): Promise<LivePrice | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: LivePrice | null = null;
  if (PRODUCT_PAGE.test(url)) {
    const html = await get(url);
    const p = html ? priceFromPage(html) : null;
    if (p) v = { ...p, url, checkedAt: new Date().toISOString() };
  }
  if (!v) v = await fromSearch(name);
  cache.set(id, { at: Date.now(), v });
  return v;
}
