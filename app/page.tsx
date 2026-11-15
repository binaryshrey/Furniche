import Link from 'next/link';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PRODUCTS, RETAILER_LABEL } from '@/catalog/products';
import HomeExplorer from '@/components/home/HomeExplorer';
import { TopNav } from '@/components/ui/Brand';
import { describe, parseQuery, search } from '@/lib/search';
import type { Listing } from '@/lib/types';

// The banner shows this listing's empty-room scan and opens the same home.
const FEATURED = { sid: '6dgWVBzerB7', label: '1623 Fawnhope Drive, Houston' };
const thumb = (sid: string, w = 960) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=${w}`;
const FIRST_QUERY = 'apartments';

// The first search, so the explorer renders with results.
async function load() {
  try {
    const d = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8')) as { homes: Listing[]; apartments: Listing[] };
    const filters = parseQuery(FIRST_QUERY);
    const results = search([...d.homes, ...d.apartments], filters);
    return { initial: { q: FIRST_QUERY, summary: describe(filters), total: results.length, results } };
  } catch {
    return { initial: { q: FIRST_QUERY, summary: '', total: 0, results: [] } };
  }
}

export default async function Home() {
  const { initial } = await load();

  return (
    <div className="min-h-screen">
      <TopNav name="Furniche AI" home />

      <section className="px-4 pb-10 pt-12 sm:px-6 md:pt-16">
        <div className="mx-auto max-w-5xl text-center">
          <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
            <span className="block">Discover your dream home.</span>
            {/* One line from tablet width up; phones are too narrow and wrap. */}
            <span className="block text-brand md:whitespace-nowrap">Fully furnished before you move in.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base font-light leading-relaxed text-muted">
            Explore 3,000+ Houston homes, walk through any of them and let AI furnish every room with artistic furniture and appliances.
          </p>
        </div>
      </section>

      <HomeExplorer initial={initial} />

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
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
          <span>© 2026 Furniche AI · Built at HackPrinceton for the CoStar track with Matterport, Vexcel and CoStar data</span>
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
