'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import SearchBar from '@/components/search/SearchBar';
import { Logo } from '@/components/ui/Brand';
import type { SearchResult } from '@/lib/search';

// three.js and the tile streamer are browser-only.
const SkyView = dynamic(() => import('@/components/sky/SkyView'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Starting the 3D city…</div>,
});

// Vexcel's Houston 3D collection (us-tx-houstonr2-2023) spans 29.47–29.83 N, 95.99–95.32 W. Pins
// stay ~2 km inside it so a home never sits at the ragged edge of the mesh.
const COVERAGE = { south: 29.49, north: 29.81, west: -95.97, east: -95.34 };
const inCoverage = (r: { lat: number; lon: number }) =>
  r.lat > COVERAGE.south && r.lat < COVERAGE.north && r.lon > COVERAGE.west && r.lon < COVERAGE.east;
const DOWNTOWN = { lat: 29.7589, lon: -95.3677 };
const MAX_PINS = 250;
const thumb = (sid: string) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=640`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

type Response = { summary: string; total: number; results: SearchResult[] };

export default function SkyPage({ searchParams }: { searchParams: { q?: string; focus?: string } }) {
  const q = searchParams.q ?? 'apartments';
  const router = useRouter();
  const [data, setData] = useState<Response | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ summary: '', total: 0, results: [] }));
  }, [q]);

  const shown = useMemo(() => {
    const inside = (data?.results ?? []).filter(inCoverage);
    const focus = inside.find((r) => r.sid === searchParams.focus);
    const rest = inside.filter((r) => r !== focus).slice(0, MAX_PINS - (focus ? 1 : 0));
    return focus ? [focus, ...rest] : rest;
  }, [data, searchParams.focus]);
  const outside = (data?.total ?? 0) - (data?.results ?? []).filter(inCoverage).length;

  // Start over the focused home, else over the middle of the matches.
  const center = useMemo(() => {
    const focus = shown.find((r) => r.sid === searchParams.focus);
    if (focus) return { lat: focus.lat, lon: focus.lon };
    if (!shown.length) return DOWNTOWN;
    return { lat: median(shown.map((r) => r.lat)), lon: median(shown.map((r) => r.lon)) };
  }, [shown, searchParams.focus]);

  const pins = useMemo(() => shown.map((r) => ({ sid: r.sid, lat: r.lat, lon: r.lon, label: r.priceLabel })), [shown]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line bg-paper px-4 py-3 sm:px-6">
        <Logo />
        <div className="order-3 w-full sm:order-none sm:w-auto sm:max-w-xl sm:flex-1">
          <SearchBar defaultValue={searchParams.q ?? ''} size="sm" action="/sky" />
        </div>
        <nav className="ml-auto flex items-center gap-1 text-sm font-semibold sm:gap-2">
          <Link href={`/search?q=${encodeURIComponent(q)}`} className="rounded-full px-3 py-2 transition hover:bg-card">
            Map
          </Link>
          <span className="rounded-full bg-ink px-3 py-2 text-paper">3D city</span>
          <Link href="/cart" className="rounded-full px-3 py-2 transition hover:bg-card">
            Cart
          </Link>
        </nav>
      </header>

      <div className="relative min-h-0 flex-1">
        {data && (
          <SkyView
            center={center}
            pins={pins}
            activeSid={hover}
            flyToSid={flyTo}
            onPick={(sid) => router.push(`/space/${sid}`)}
            onHover={setHover}
          />
        )}

        <div className="pointer-events-none absolute left-4 top-4 z-10 max-w-[calc(100%-2rem)] rounded-2xl bg-paper/85 px-4 py-3 backdrop-blur sm:left-6">
          {!data ? (
            <span className="text-sm text-muted">Searching…</span>
          ) : (
            <>
              <div className="font-display text-lg leading-tight">{data.summary || 'Houston listings'}</div>
              <div className="text-xs text-muted">
                {shown.length.toLocaleString()} floating over Vexcel&apos;s 3D Houston
                {outside > 0 ? ` · ${outside.toLocaleString()} outside the 3D area` : ''}
              </div>
            </>
          )}
        </div>

        {shown.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-paper via-paper/80 to-transparent pb-4 pt-10 [&>*]:pointer-events-auto">
            <div className="px-4 pb-2 text-xs text-muted sm:px-6">Hover a home to fly to it · click to walk inside</div>
            <div className="scroll-thin flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-6">
              {shown.map((r) => (
                <button
                  key={r.sid}
                  onClick={() => router.push(`/space/${r.sid}`)}
                  onMouseEnter={() => {
                    setHover(r.sid);
                    setFlyTo(r.sid);
                  }}
                  onMouseLeave={() => setHover(null)}
                  className={`group w-56 shrink-0 snap-start overflow-hidden rounded-xl border bg-card text-left transition ${hover === r.sid ? 'border-ink/60' : 'border-line hover:border-ink/40'}`}
                >
                  <div className="aspect-[16/10] overflow-hidden bg-panel">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb(r.sid)} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                  </div>
                  <div className="p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num font-semibold">{r.priceLabel}</span>
                      <span className="text-[11px] text-muted">{r.beds === 0 ? 'Studio' : r.beds != null ? `${r.beds} bd` : ''}</span>
                    </div>
                    <div className="truncate text-sm">{r.title}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
