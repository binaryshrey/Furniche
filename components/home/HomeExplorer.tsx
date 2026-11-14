'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry } from '@/components/sky/SkyView';
import { getEntry, preloadEntry } from '@/lib/entryCache';
import { useViewerState } from '@/lib/sceneBridge';
import { useOnMesh } from '@/lib/coverage';
import type { SearchResult } from '@/lib/search';

// three.js and the tile streamer are browser-only.
const SkyView = dynamic(() => import('@/components/sky/SkyView'), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center bg-panel text-sm text-muted">Starting the 3D city…</div>,
});

const Editor = dynamic(() => import('@/components/Editor'), { ssr: false });

type Response = { summary: string; total: number; results: SearchResult[] };

// Sky → house timings (same as /sky).
const EXPAND_MS = 600; // the city panel grows to full screen
const SETTLE_MS = 700; // let the first panorama paint before revealing it
const FADE_MS = 1300; // crossfade, timed with the camera's dive into the house
const TOUR_TIMEOUT_MS = 25000;

// Quick filters, each a plain-language search.
const PILLS: { label: string; q: string }[] = [
  { label: 'All apartments', q: 'apartments' },
  { label: 'Studios', q: 'studio apartments' },
  { label: '1 bed', q: '1 bed apartments' },
  { label: '2 beds', q: '2 bed apartments' },
  { label: '3+ beds', q: '3+ bed apartments' },
  { label: 'Under $1,000', q: 'apartments under $1,000' },
  { label: 'Under $1,500', q: 'apartments under $1,500' },
  { label: 'Homes for sale', q: 'homes for sale' },
  { label: 'Montrose', q: 'apartments in Montrose' },
  { label: 'The Heights', q: 'apartments in the Heights' },
  { label: 'Midtown', q: 'apartments in Midtown' },
  { label: 'Downtown', q: 'apartments in Downtown' },
];
const PAGE = 24;
const MAX_PINS = 250;
const thumb = (sid: string) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=640`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function Card({
  r,
  active,
  onHover,
  onBroken,
  onOpen,
}: {
  r: SearchResult;
  active: boolean;
  onHover: (sid: string | null) => void;
  onBroken: () => void;
  onOpen?: () => void; // fly in from the 3D city instead of a plain page load
}) {
  const [amount, unit] = r.rent ? [r.priceLabel.replace('/mo', ''), 'month'] : [r.priceLabel, 'for sale'];
  return (
    <Link
      href={`/space/${r.sid}`}
      className="group block"
      onMouseEnter={() => onHover(r.sid)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        onOpen();
      }}
    >
      <div className={`relative aspect-[20/19] overflow-hidden rounded-xl bg-panel ring-2 transition ${active ? 'ring-brand' : 'ring-transparent'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(r.sid)} alt="" loading="lazy" onError={onBroken} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
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

// Search, quick filters and listings beside the live 3D city, Airbnb-style: hover a listing
// and the camera flies to it; click a pin or a card to walk through the home.
export default function HomeExplorer({ initial }: { initial: Response & { q: string } }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [draft, setDraft] = useState(initial.q);
  const [data, setData] = useState<Response | null>(initial);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  // The page waits behind a loading screen until the whole 3D city is local and the first view
  // is at full detail, so it is crystal clear from the first frame.
  const [city, setCity] = useState({ done: 0, total: 0, sharp: false });
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);
  const [patience, setPatience] = useState(false);
  useEffect(() => {
    if (!ready && city.total > 0 && city.done >= city.total && city.sharp) setReady(true);
  }, [city, ready]);
  useEffect(() => {
    if (!ready) {
      document.documentElement.style.overflow = 'hidden';
      const t = setTimeout(() => setPatience(true), 45000);
      return () => clearTimeout(t);
    }
    document.documentElement.style.overflow = '';
    window.scrollTo(0, 0);
    const t = setTimeout(() => setGone(true), 700);
    return () => clearTimeout(t);
  }, [ready]);
  useEffect(() => () => void (document.documentElement.style.overflow = ''), []);

  // Same cache as /sky: an instant answer from the last visit while a fresh one loads.
  useEffect(() => {
    if (q === initial.q) return;
    const key = `furniche-search:${q}`;
    try {
      const cached = JSON.parse(localStorage.getItem(key) ?? 'null') as Response | null;
      if (cached) setData(cached);
    } catch {
      /* storage unavailable */
    }
    setLoading(true);
    let live = true;
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((d: Response) => {
        if (!live) return;
        setData(d);
        try {
          localStorage.setItem(key, JSON.stringify({ summary: d.summary, total: d.total, results: d.results }));
        } catch {
          /* over quota */
        }
      })
      .catch(() => {})
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [q, initial.q]);

  const results = useMemo(() => (data?.results ?? []).filter((r) => !broken.has(r.sid)), [data, broken]);
  const onMesh = useOnMesh();
  const inCity = useMemo(() => results.filter(onMesh).slice(0, MAX_PINS), [results, onMesh]);
  const pins = useMemo(() => inCity.map((r) => ({ sid: r.sid, lat: r.lat, lon: r.lon, label: r.priceLabel })), [inCity]);
  const lookAt = useMemo(
    () => (inCity.length ? { lat: median(inCity.map((r) => r.lat)), lon: median(inCity.map((r) => r.lon)) } : null),
    [inCity],
  );
  const pinned = useMemo(() => new Set(inCity.map((r) => r.sid)), [inCity]);

  const choose = (next: string) => {
    setQ(next);
    setDraft(next);
    setLimit(PAGE);
    setHover(null);
    setFlyTo(null);
  };
  // Warm the server for a likely click: the entry (floor plan + 360° photo links) is what the
  // fly-in needs, and the first lookup for a home takes a couple of seconds.
  const warmed = useRef(new Set<string>());
  const warm = (sid: string | null) => {
    if (!sid || warmed.current.has(sid)) return;
    warmed.current.add(sid);
    preloadEntry(sid);
  };
  const hoverCard = (sid: string | null) => {
    setHover(sid);
    warm(sid);
    if (sid && pinned.has(sid)) setFlyTo(sid);
  };

  const pct = city.total ? Math.round((city.done / city.total) * 100) : 0;

  // One continuous scene into a home: the city panel grows to full screen, the camera glides
  // down beside the house while its tour loads underneath, then dives in as the city crossfades
  // into the room. The address becomes /space/<id> without a page load.
  const panel = useRef<HTMLDivElement>(null);
  const [entering, setEntering] = useState<SearchResult | null>(null);
  const [frame, setFrame] = useState<React.CSSProperties | null>(null);
  const [descended, setDescended] = useState(false);
  const [settled, setSettled] = useState(false);
  const [fading, setFading] = useState(false);
  const [inside, setInside] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const showingRoom = useViewerState((st) => st.showingRoom);

  function enter(r: SearchResult) {
    if (entering) return;
    if (!pinned.has(r.sid)) return router.push(`/space/${r.sid}`); // outside the 3D area
    const box = panel.current!.getBoundingClientRect();
    setFrame({ position: 'fixed', top: box.top, left: box.left, width: box.width, height: box.height, borderRadius: 16 });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setFrame({ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', borderRadius: 0 })),
    );
    document.documentElement.style.overflow = 'hidden';
    setEntry(null);
    // The 360° photo where the tour opens: the flight ends inside it.
    getEntry(r.sid).then((e) => e && setEntry(e));
    setHover(r.sid);
    setDescended(false);
    setFading(false);
    // Start the descent once the panel has grown, so the flight is seen full screen.
    setTimeout(() => setEntering(r), EXPAND_MS);
  }
  function reset() {
    setEntering(null);
    setFrame(null);
    setDescended(false);
    setFading(false);
    setInside(false);
    setEntry(null);
    document.documentElement.style.overflow = '';
  }

  useEffect(() => {
    if (!showingRoom) return setSettled(false);
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [showingRoom]);
  useEffect(() => {
    if (entering && descended && settled && !fading) setFading(true);
  }, [entering, descended, settled, fading]);
  useEffect(() => {
    if (!descended || fading) return;
    const t = setTimeout(() => setFading(true), TOUR_TIMEOUT_MS); // never strand the user in the sky
    return () => clearTimeout(t);
  }, [descended, fading]);
  useEffect(() => {
    if (!fading || !entering) return;
    const t = setTimeout(() => {
      window.history.pushState(null, '', `/space/${entering.sid}`);
      setInside(true);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [fading, entering]);
  // Browser Back from the home returns to the page.
  useEffect(() => {
    const onPop = () => window.location.pathname === '/' && reset();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <section id="explore" className="border-t border-line">
      {!gone && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-paper transition-opacity duration-700"
          style={{ opacity: ready ? 0 : 1, pointerEvents: ready ? 'none' : undefined }}
          role="status"
          aria-live="polite"
        >
          <div className="w-[min(420px,calc(100vw-32px))] text-center">
            <div className="font-display text-3xl font-bold tracking-tight">Furniche AI</div>
            <p className="mt-2 text-sm text-muted">Finding your dream home…</p>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full bg-brand transition-[width] duration-300" style={{ width: `${city.done < city.total || !city.total ? pct * 0.95 : city.sharp ? 100 : 97}%` }} />
            </div>
            <div className="mt-2 text-xs text-muted">
              {city.done < city.total || !city.total ? `${pct}%` : 'Almost there'}
            </div>
            {patience && (
              <button onClick={() => setReady(true)} className="mt-6 text-sm font-semibold underline underline-offset-4">
                Continue without waiting
              </button>
            )}
          </div>
        </div>
      )}
      {/* Search and quick filters stay on top while the list scrolls. */}
      <div className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-col items-center gap-3 px-4 py-4 sm:px-6">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) choose(draft.trim());
            }}
            className="flex w-full max-w-2xl items-center rounded-full border border-line bg-card p-1.5 pl-6 shadow-[0_3px_12px_rgba(0,0,0,0.45)] transition focus-within:border-ink/30"
          >
            <label className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold">Where · what · budget</span>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="3 bed apartments under $2,000"
                aria-label="Search homes and apartments"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
            </label>
            <button type="submit" aria-label="Search" className="btn-brand grid h-11 w-11 shrink-0 place-items-center rounded-full">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="3" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </button>
          </form>
          <div className="scroll-thin flex max-w-full gap-2 overflow-x-auto pb-1">
            {PILLS.map((p) => (
              <button
                key={p.q}
                onClick={() => choose(p.q)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
                  q === p.q ? 'border-ink bg-ink font-semibold text-paper' : 'border-line hover:border-ink/40'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        {/* The 3D city: first on phones, a sticky panel beside the list on wide screens. */}
        {/* A sticky element confines its children's z-index, so the panel itself must rise above
            the editor layer while flying in. */}
        <div ref={panel} className="relative h-[55vh] lg:sticky lg:top-[136px] lg:order-2 lg:h-[calc(100vh-160px)]" style={{ zIndex: frame ? 70 : undefined }}>
          {!inside && (
            <div
              className="absolute inset-0 z-[70] overflow-hidden rounded-2xl border border-line bg-paper ease-out"
              style={{
                ...frame,
                transitionProperty: 'top, left, width, height, border-radius, opacity, transform',
                transitionDuration: fading ? `${FADE_MS}ms` : `${EXPAND_MS}ms`,
                opacity: fading ? 0 : 1,
                transform: fading ? 'scale(1.08)' : undefined,
                pointerEvents: fading ? 'none' : undefined,
              }}
            >
              <SkyView
                snapshotKey={`home:${q}`}
                lookAt={lookAt}
                pins={pins}
                activeSid={hover}
                flyToSid={flyTo}
                enterSid={entering?.sid ?? null}
                dive={fading}
                entry={entry}
                onDescended={() => setDescended(true)}
                onPick={(sid) => {
                  const r = results.find((x) => x.sid === sid);
                  if (r) enter(r);
                }}
                onHover={(sid) => {
                  setHover(sid);
                  warm(sid);
                }}
                onLoadState={setCity}
              />
              {frame && !fading && (
                <div className="absolute left-4 top-4 flex items-center gap-3 rounded-2xl bg-paper/85 px-4 py-3 backdrop-blur">
                  <div>
                    <div className="text-sm font-semibold">{entering?.title ?? hover}</div>
                    <div className="text-xs text-muted">{descended ? 'Opening the home…' : 'Flying in…'}</div>
                  </div>
                  <button onClick={reset} className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:border-ink/40">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* The home's editor boots underneath while the camera descends. */}
        {entering && (
          <div
            className="fixed inset-0 z-[60] bg-paper ease-out"
            style={{ transform: fading ? 'scale(1)' : 'scale(1.06)', transition: `transform ${FADE_MS}ms` }}
          >
            <Editor sid={entering.sid} />
          </div>
        )}

        <div className="lg:order-1">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl">
                {data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'home' : 'homes'}` : 'Searching…'}
                {loading && <span className="ml-2 text-sm font-normal text-muted">updating…</span>}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {data?.summary || 'Houston listings'} · {inCity.length.toLocaleString()} on the 3D city
              </p>
            </div>
            <div className="flex shrink-0 gap-3 text-sm font-semibold">
              <Link href={`/search?q=${encodeURIComponent(q)}`} className="underline underline-offset-4">
                Map
              </Link>
              <Link href={`/sky?q=${encodeURIComponent(q)}`} className="underline underline-offset-4">
                Full-screen 3D
              </Link>
            </div>
          </div>

          {data && !results.length && <p className="mt-10 text-sm text-muted">No listings match. Try another search or a quick filter.</p>}
          <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
            {results.slice(0, limit).map((r) => (
              <Card
                key={r.sid}
                r={r}
                active={hover === r.sid}
                onHover={hoverCard}
                onBroken={() => setBroken((b) => new Set(b).add(r.sid))}
                onOpen={pinned.has(r.sid) ? () => enter(r) : undefined}
              />
            ))}
          </div>
          {results.length > limit && (
            <div className="mt-10 text-center">
              <button onClick={() => setLimit((n) => n + PAGE)} className="rounded-lg border border-ink px-6 py-3 text-sm font-semibold transition hover:bg-card">
                Show more
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
