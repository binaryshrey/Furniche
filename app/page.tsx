import Link from 'next/link';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCTS, RETAILER_LABEL } from '@/catalog/products';
import SearchBar from '@/components/search/SearchBar';
import { TopNav } from '@/components/ui/Brand';
import { toResult, type SearchResult } from '@/lib/search';
import type { Listing } from '@/lib/types';

// The banner shows this listing's empty-room scan and opens the same home.
const FEATURED = { sid: '6dgWVBzerB7', label: '1623 Fawnhope Drive, Houston' };
const thumb = (sid: string, w = 960) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=${w}`;
const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;

// Category shortcuts, each a plain-language search on the map.
const CATEGORIES: { label: string; q: string; icon: string; href?: string }[] = [
  { label: '3D city', q: 'apartments', href: '/sky?q=apartments', icon: 'M3 21h18M5 21V10l4-3v14M9 21V4l6 3v14M15 21v-9l4 2v7' },
  { label: 'Apartments', q: 'apartments', icon: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2' },
  { label: '3+ beds', q: '3+ bed apartments', icon: 'M3 18v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 18h18M3 14h18M7 10V7h4v3' },
  { label: 'Studios', q: 'studio apartments', icon: 'M4 21V4h16v17M9 21v-6h6v6M8 8h8' },
  { label: 'For sale', q: 'homes for sale', icon: 'M3 11 12 4l9 7M5 10v11h14V10M10 21v-6h4v6' },
  { label: 'Under $1,500', q: 'apartments under $1,500', icon: 'M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.6 4.5 3 4.5 1.4 4.5 3.2-2 3-4.5 3-4.5-1.3-4.5-3' },
  { label: 'Montrose', q: 'apartments in Montrose', icon: 'M12 21s-7-6.3-7-12a7 7 0 0 1 14 0c0 5.7-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z' },
  { label: 'The Heights', q: 'apartments in the Heights', icon: 'M3 17c3-3 6-3 9 0s6 3 9 0M3 12c3-3 6-3 9 0s6 3 9 0' },
  { label: 'Midtown', q: 'apartments in Midtown', icon: 'M2 18h20M5 18a7 7 0 0 1 14 0M12 4v3M4.9 8.9l2.1 2.1M19.1 8.9 17 11' },
];

async function hasThumb(sid: string): Promise<boolean> {
  try {
    const res = await fetch(thumb(sid, 16), { next: { revalidate: 86_400 } });
    return res.ok && (res.headers.get('content-type') ?? '').startsWith('image');
  } catch {
    return false;
  }
}

async function featured(): Promise<{ rentals: SearchResult[]; forSale: SearchResult[]; homes: number; apartments: number } | null> {
  try {
    const d = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8')) as { homes: Listing[]; apartments: Listing[] };
    const pick = async (rows: Listing[], ok: (r: SearchResult) => boolean, n: number) => {
      const seen = new Set<string>();
      const out: SearchResult[] = [];
      for (const r of rows.map(toResult)) {
        if (!r || !ok(r) || seen.has(r.title)) continue;
        // A few scans are no longer public on Matterport; skip any without a thumbnail.
        if (!(await hasThumb(r.sid))) continue;
        seen.add(r.title);
        out.push(r);
        if (out.length === n) break;
      }
      return out;
    };
    return {
      rentals: await pick(d.apartments, (r) => r.price != null && r.price >= 1100 && r.beds != null, 8),
      forSale: await pick(d.homes, (r) => r.price != null && !r.rent && r.price >= 300_000, 4),
      homes: d.homes.length,
      apartments: d.apartments.length,
    };
  } catch {
    return null;
  }
}

function Card({ r }: { r: SearchResult }) {
  const [amount, unit] = r.rent ? [r.priceLabel.replace('/mo', ''), 'month'] : [r.priceLabel, 'for sale'];
  return (
    <Link href={`/space/${r.sid}`} className="group block">
      <div className="relative aspect-[20/19] overflow-hidden rounded-xl bg-panel">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(r.sid, 640)} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
        <span className="absolute left-3 top-3 rounded-full bg-paper/85 px-2.5 py-1 text-[11px] font-semibold backdrop-blur">Empty-room 3D</span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{r.title}</div>
          <div className="truncate text-sm text-muted">{r.subtitle}</div>
        </div>
        {r.beds != null && <span className="shrink-0 text-sm">{r.beds === 0 ? 'Studio' : `${r.beds} bd`}</span>}
      </div>
      <div className="mt-1 text-[15px]">
        <span className="font-semibold">{amount}</span> <span className="text-muted">{unit}</span>
      </div>
    </Link>
  );
}

export default async function Home() {
  const f = await featured();

  return (
    <div className="min-h-screen">
      <TopNav />

      <section className="px-4 pb-6 pt-12 sm:px-6 md:pt-16">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">Find a home. Furnish it before you move in.</h1>
          <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted">
            Search {f ? (f.homes + f.apartments).toLocaleString() : ''} Houston listings, walk through each one empty in 3D, and drop in real
            furniture at its true size.
          </p>
          <div className="mx-auto mt-8 max-w-2xl text-left">
            <SearchBar />
          </div>
        </div>
      </section>

      <nav aria-label="Categories" className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="scroll-thin mx-auto flex max-w-6xl gap-8 overflow-x-auto px-4 sm:px-6">
          {CATEGORIES.map((c) => (
            <Link
              key={c.label}
              href={c.href ?? searchHref(c.q)}
              className="flex shrink-0 flex-col items-center gap-2 border-b-2 border-transparent py-4 text-xs font-medium text-muted transition hover:border-line hover:text-ink"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={c.icon} />
              </svg>
              {c.label}
            </Link>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {f && (
          <>
            <section className="pt-10">
              <div className="flex items-end justify-between gap-4">
                <h2 className="font-display text-2xl">Apartments for rent in Houston</h2>
                <Link href={searchHref('apartments')} className="shrink-0 text-sm font-semibold underline underline-offset-4">
                  Show on map
                </Link>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {f.rentals.map((r) => (
                  <Card key={r.sid} r={r} />
                ))}
              </div>
            </section>

            <section className="pt-14">
              <div className="flex items-end justify-between gap-4">
                <h2 className="font-display text-2xl">Homes for sale</h2>
                <Link href={searchHref('homes for sale')} className="shrink-0 text-sm font-semibold underline underline-offset-4">
                  Show on map
                </Link>
              </div>
              <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
                {f.forSale.map((r) => (
                  <Card key={r.sid} r={r} />
                ))}
              </div>
            </section>
          </>
        )}

        <section className="mt-16 grid gap-8 rounded-2xl bg-card p-8 md:grid-cols-3 md:p-10">
          {[
            ['Search in plain words', 'Type what you need, like “2 bed in the Heights under $1,800”, and browse matches on an aerial map.'],
            ['Walk the empty room', 'Every listing opens as a 3D scan with the seller’s furniture taken out, measured to the centimetre.'],
            ['Furnish and shop', `Drop in ${PRODUCTS.length} pieces from ${new Set(PRODUCTS.map((p) => p.retailer)).size} stores at true size, check the fit, and leave with one list.`],
          ].map(([h, b], i) => (
            <div key={h}>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-panel text-sm font-semibold">{i + 1}</div>
              <h3 className="mt-4 text-lg font-semibold">{h}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{b}</p>
            </div>
          ))}
        </section>

        <section className="relative mt-16 overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(FEATURED.sid, 1600)} alt={`Empty living room at ${FEATURED.label}`} className="h-[420px] w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
          <div className="absolute inset-y-0 left-0 flex max-w-md flex-col justify-center p-8 md:p-12">
            <h2 className="font-display text-3xl text-white md:text-4xl">Try it on a real empty room</h2>
            <p className="mt-3 text-sm text-white/80">{FEATURED.label}. Drag in a sofa and see whether it fits before you sign anything.</p>
            <Link href={`/space/${FEATURED.sid}`} className="btn-brand mt-6 w-fit rounded-lg px-6 py-3.5 text-sm font-semibold">
              Furnish this room
            </Link>
          </div>
        </section>
      </main>

      <footer className="mt-20 border-t border-line bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-muted sm:px-6">
          <span>© 2026 Furniche · Built at HackPrinceton for the CoStar track with Matterport, Vexcel and CoStar data</span>
          <span>
            {Object.values(RETAILER_LABEL)
              .filter((r) => r !== 'Other')
              .join(' · ')}
          </span>
        </div>
      </footer>
    </div>
  );
}
