'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SearchBar from '@/components/search/SearchBar';
import { Logo } from '@/components/ui/Brand';
import { useOnMesh } from '@/lib/coverage';
import type { Entry } from '@/components/sky/SkyView';
import { entryUrl } from '@/lib/entrySkip';
import { useViewerState } from '@/lib/sceneBridge';
import type { SearchResult } from '@/lib/search';

// three.js, the tile streamer and Matterport are browser-only.
const SkyView = dynamic(() => import('@/components/sky/SkyView'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-muted">Starting the 3D city…</div>,
});
const Editor = dynamic(() => import('@/components/Editor'), { ssr: false });

const MAX_PINS = 250;
const TOUR_TIMEOUT_MS = 25000; // after this, offer to open the tour anyway instead of fading into a loading screen
const SETTLE_MS = 700; // let the first panorama paint before revealing it
const FADE_MS = 1300; // timed with the camera's dive into the house
const thumb = (sid: string) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=640`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sqft = (m2: number) => `${Math.round(m2 * 10.764).toLocaleString()} sq ft`;

type Response = { summary: string; total: number; results: SearchResult[] };
type Surroundings = { parcel: { x: number; y: number }[]; buildings: { x: number; y: number }[][]; pool: boolean; hardscapeM2: number | null; treeCoverPct: number | null };

const area = (poly: { x: number; y: number }[]) =>
  Math.abs(poly.reduce((s, a, i) => s + a.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * a.y, 0)) / 2;

// One continuous scene: pick a home in the 3D city, the camera descends to it while its
// Matterport tour loads underneath, and the city crossfades into the interior. The address
// changes to /space/<id> without a page load, so there is never a blank frame.
export default function SkyPage({ searchParams }: { searchParams: { q?: string; focus?: string } }) {
  const q = searchParams.q ?? 'apartments';
  const [data, setData] = useState<Response | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<string | null>(null);
  const [entering, setEntering] = useState<SearchResult | null>(null);
  const [descended, setDescended] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fading, setFading] = useState(false);
  const [inside, setInside] = useState(false);
  const [surroundings, setSurroundings] = useState<Surroundings | null>(null);
  const showingRoom = useViewerState((s) => s.showingRoom);
  const [settled, setSettled] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);

  // Results are cached in localStorage per query, so pins appear instantly on a revisit while a
  // fresh copy loads in the background.
  useEffect(() => {
    const key = `furniche-search:${q}`;
    let cached: Response | null = null;
    try {
      cached = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      /* storage unavailable */
    }
    setData(cached);
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d: Response) => {
        setData(d);
        try {
          localStorage.setItem(key, JSON.stringify(d));
        } catch {
          /* over quota: skip */
        }
      })
      .catch(() => setData((prev) => prev ?? { summary: '', total: 0, results: [] }));
  }, [q]);

  const onMesh = useOnMesh();
  const shown = useMemo(() => {
    const inArea = (data?.results ?? []).filter(onMesh);
    const focus = inArea.find((r) => r.sid === searchParams.focus);
    const rest = inArea.filter((r) => r !== focus).slice(0, MAX_PINS - (focus ? 1 : 0));
    return focus ? [focus, ...rest] : rest;
  }, [data, searchParams.focus, onMesh]);
  const outside = (data?.total ?? 0) - (data?.results ?? []).filter(onMesh).length;

  // Overview target: the focused home, else the middle of the matches.
  const lookAt = useMemo(() => {
    const focus = shown.find((r) => r.sid === searchParams.focus);
    if (focus) return { lat: focus.lat, lon: focus.lon };
    if (!shown.length) return null;
    return { lat: median(shown.map((r) => r.lat)), lon: median(shown.map((r) => r.lon)) };
  }, [shown, searchParams.focus]);

  const pins = useMemo(() => shown.map((r) => ({ sid: r.sid, lat: r.lat, lon: r.lon, label: r.priceLabel })), [shown]);

  // Warm the server for a likely click (see HomeExplorer): the fly-in needs the home's entry.
  const warmed = useMemo(() => new Set<string>(), []);
  const hoverPin = (sid: string | null) => {
    setHover(sid);
    if (sid && !warmed.has(sid)) {
      warmed.add(sid);
      fetch(entryUrl(sid)).catch(() => {});
    }
  };

  function enter(sid: string) {
    const r = shown.find((x) => x.sid === sid);
    if (!r || entering) return;
    setEntering(r);
    setDescended(false);
    setSlow(false);
    setSurroundings(null);
    setEntry(null);
    // The 360° photo where the tour opens: the flight ends inside it.
    fetch(entryUrl(r.sid))
      .then((x) => (x.ok ? x.json() : null))
      .then((d) => d?.faces && setEntry({ faces: d.faces, eyeHeight: d.eyeHeight }))
      .catch(() => {});
    if (r.listingId) {
      fetch(`/api/vexcel/property?listing=${r.listingId}`)
        .then((x) => (x.ok ? x.json() : null))
        .then((d) => d && !d.error && setSurroundings(d))
        .catch(() => {});
    }
  }

  function cancel() {
    setEntering(null);
    setEntry(null);
    setDescended(false);
    setFading(false);
  }

  // Fade the city out once the camera has arrived and the tour is ready (or after a timeout).
  useEffect(() => {
    if (!descended) return;
    const id = setTimeout(() => setSlow(true), TOUR_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [descended]);
  // Reveal only once Matterport is showing a room (not its dark dollhouse/loading view), and
  // has held it long enough for the panorama to paint.
  useEffect(() => {
    if (!showingRoom) return setSettled(false);
    const id = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(id);
  }, [showingRoom]);
  useEffect(() => {
    if (entering && descended && !fading && settled) setFading(true);
  }, [entering, descended, settled, fading]);
  // Browser Back from the home returns to the city (the tiles come back from the disk cache).
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname !== '/sky') return;
      setEntering(null);
      setDescended(false);
      setFading(false);
      setInside(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // After the crossfade: switch the address to the home and drop the 3D city to free the GPU.
  useEffect(() => {
    if (!fading || !entering) return;
    const id = setTimeout(() => {
      window.history.pushState(null, '', `/space/${entering.sid}`);
      setInside(true);
    }, FADE_MS);
    return () => clearTimeout(id);
  }, [fading, entering]);

  return (
    <>
      {/* The home's editor boots underneath while the camera descends. */}
      {entering && (
        <div className="fixed inset-0 z-10 ease-out" style={{ transform: fading ? 'scale(1)' : 'scale(1.06)', transition: `transform ${FADE_MS}ms` }}>
          <Editor sid={entering.sid} />
        </div>
      )}

      {!inside && (
        <div
          className="fixed inset-0 z-20 flex flex-col bg-paper transition-[opacity,transform] ease-out"
          style={{ opacity: fading ? 0 : 1, transform: fading ? 'scale(1.08)' : undefined, transitionDuration: `${FADE_MS}ms`, pointerEvents: fading ? 'none' : undefined }}
        >
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
            {/* Mounted straight away: the city streams while the search runs. */}
            <SkyView
              snapshotKey={q}
              lookAt={lookAt}
              pins={pins}
              activeSid={hover}
              flyToSid={flyTo}
              enterSid={entering?.sid ?? null}
              dive={fading}
              entry={entry}
              onDescended={() => setDescended(true)}
              onPick={enter}
              onHover={hoverPin}
            />

            {!entering && (
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
            )}

            {/* Surroundings while the camera descends. */}
            {entering && (
              <div className="absolute left-4 top-4 z-10 w-[min(22rem,calc(100%-2rem))] overflow-hidden rounded-2xl bg-paper/90 shadow-swatch backdrop-blur sm:left-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumb(entering.sid)} alt="" className="aspect-[16/9] w-full object-cover" />
                <div className="space-y-2 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-lg">{entering.title}</span>
                    <span className="num shrink-0 font-semibold">{entering.priceLabel}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{entering.subtitle}</div>
                  {surroundings && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-line pt-2 text-xs">
                      <dt className="text-muted">Lot</dt>
                      <dd className="num text-right">{sqft(area(surroundings.parcel))}</dd>
                      <dt className="text-muted">Buildings</dt>
                      <dd className="num text-right">{sqft(surroundings.buildings.reduce((s, b) => s + area(b), 0))}</dd>
                      <dt className="text-muted">Paved</dt>
                      <dd className="num text-right">{surroundings.hardscapeM2 != null ? sqft(surroundings.hardscapeM2) : '—'}</dd>
                      <dt className="text-muted">Pool · tree cover</dt>
                      <dd className="text-right">
                        {surroundings.pool ? 'Pool' : 'No pool'} · {surroundings.treeCoverPct != null ? `${Math.round(surroundings.treeCoverPct)}%` : '—'}
                      </dd>
                    </dl>
                  )}
                  <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
                    <span>{!descended ? 'Flying in…' : settled ? 'Stepping inside…' : slow ? 'The tour is taking a while…' : 'Opening the 3D tour…'}</span>
                    {slow && !settled && !fading && (
                      <button onClick={() => setFading(true)} className="font-semibold text-ink underline underline-offset-2">
                        Open anyway
                      </button>
                    )}
                    {!fading && (
                      <button onClick={cancel} className="font-semibold text-ink underline underline-offset-2">
                        Back to the city
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {shown.length > 0 && !entering && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-paper via-paper/80 to-transparent pb-4 pt-10 [&>*]:pointer-events-auto">
                <div className="px-4 pb-2 text-xs text-muted sm:px-6">Hover a home to fly to it · click to go inside</div>
                <div className="scroll-thin flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:px-6">
                  {shown.map((r) => (
                    <button
                      key={r.sid}
                      onClick={() => enter(r.sid)}
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
      )}
    </>
  );
}
