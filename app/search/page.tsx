'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import SearchBar, { EXAMPLES } from '@/components/search/SearchBar';
import { spotsOf, type Spot } from '@/components/search/spots';
import { Logo } from '@/components/ui/Brand';
import type { SearchResult } from '@/lib/search';

// Leaflet touches window on import, so the map only renders in the browser.
const SearchMap = dynamic(() => import('@/components/search/SearchMap'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Loading the aerial map…</div>,
});

const CAROUSEL_MAX = 120;
const thumb = (sid: string) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=640`;

type Response = { summary: string; total: number; results: SearchResult[]; method: 'rules' | 'ai'; error?: string };

export default function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q ?? '';
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<Spot | null>(null); // a multi-unit building narrowed into the carousel
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setData(null);
    setPicked(null);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ summary: '', total: 0, results: [], method: 'rules', error: 'Search failed. Try again.' }));
  }, [q]);

  const spots = useMemo(() => spotsOf(data?.results ?? []), [data]);
  const spotOf = useMemo(() => new Map(spots.flatMap((s) => s.items.map((r) => [r.sid, s] as const))), [spots]);
  const cards = (picked ? picked.items : data?.results ?? []).slice(0, CAROUSEL_MAX);
  const focus = hoverKey ? (spots.find((s) => s.key === hoverKey) ?? null) : picked;

  function open(r: SearchResult) {
    router.push(`/space/${r.sid}`);
  }
  function pick(spot: Spot) {
    if (spot.items.length === 1) return open(spot.items[0]);
    setPicked(spot);
    rail.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-paper px-4 py-3 sm:px-6">
        <Logo />
        <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1 sm:max-w-xl">
          <SearchBar defaultValue={q} size="sm" />
        </div>
        <nav className="ml-auto flex items-center gap-1 text-sm font-semibold sm:gap-2">
          <Link href={`/sky?q=${encodeURIComponent(q)}`} className="rounded-full px-3 py-2 transition hover:bg-card">
            3D city
          </Link>
          <Link href="/explore" className="rounded-full px-3 py-2 transition hover:bg-card">
            Homes
          </Link>
          <Link href="/cart" className="rounded-full px-3 py-2 transition hover:bg-card">
            Cart
          </Link>
        </nav>
      </header>

      <div className="relative min-h-0 flex-1">
        <SearchMap spots={spots} activeKey={hoverKey ?? picked?.key ?? null} focus={focus} onPick={pick} onHover={setHoverKey} />

        {/* What we understood */}
        <div className="pointer-events-none absolute left-4 top-4 z-[500] max-w-[calc(100%-2rem)] rounded-2xl bg-paper/85 px-4 py-3 backdrop-blur sm:left-6">
          {!data ? (
            <span className="text-sm text-muted">Searching…</span>
          ) : (
            <>
              <div className="font-display text-lg leading-tight">{data.summary || 'All listings'}</div>
              <div className="text-xs text-muted">
                {data.total.toLocaleString()} {data.total === 1 ? 'match' : 'matches'} in {spots.length.toLocaleString()} {spots.length === 1 ? 'building' : 'buildings'}
                {data.method === 'ai' ? ' · read by Claude' : ''}
              </div>
            </>
          )}
        </div>

        {data && data.total === 0 && (
          <div className="absolute left-1/2 top-1/2 z-[500] w-[min(92%,420px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-paper/95 p-6 text-center">
            <div className="font-display text-xl">{data.error ?? 'Nothing matches yet'}</div>
            <p className="mt-2 text-sm text-muted">Try a higher budget, fewer bedrooms, or one of these:</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((e) => (
                <Link key={e} href={`/search?q=${encodeURIComponent(e)}`} className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
                  {e}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Carousel of matches */}
        {cards.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[500] bg-gradient-to-t from-paper via-paper/80 to-transparent pb-4 pt-10 [&>*]:pointer-events-auto">
            <div className="flex items-baseline justify-between px-4 pb-2 text-xs text-muted sm:px-6">
              <span>
                {picked
                  ? `${picked.items.length} units at ${picked.items[0].title}`
                  : data && data.total > CAROUSEL_MAX
                    ? `Cheapest ${CAROUSEL_MAX} of ${data.total.toLocaleString()}`
                    : 'Click a home to walk through it and furnish it'}
              </span>
              {picked && (
                <button onClick={() => setPicked(null)} className="text-ink underline underline-offset-2">
                  Show all
                </button>
              )}
            </div>
            <div ref={rail} className="scroll-thin flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-6">
              {cards.map((r) => {
                const key = spotOf.get(r.sid)?.key ?? null;
                const active = key !== null && key === (hoverKey ?? picked?.key);
                return (
                  <button
                    key={r.sid}
                    onClick={() => open(r)}
                    onMouseEnter={() => setHoverKey(key)}
                    onMouseLeave={() => setHoverKey(null)}
                    onFocus={() => setHoverKey(key)}
                    className={`group w-60 shrink-0 snap-start overflow-hidden rounded-2xl border bg-card text-left transition ${active ? 'border-ink/60' : 'border-line hover:border-ink/40'}`}
                  >
                    <div className="aspect-[16/10] overflow-hidden bg-panel">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb(r.sid)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                    </div>
                    <div className="p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="num font-display text-lg">{r.priceLabel}</span>
                        <span className="text-[11px] text-muted">{r.beds === 0 ? 'Studio' : r.beds != null ? `${r.beds} bd` : r.kind === 'home' ? 'Home' : ''}</span>
                      </div>
                      <div className="truncate text-sm">{r.title}</div>
                      <div className="truncate text-[11px] text-muted">{r.subtitle}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
