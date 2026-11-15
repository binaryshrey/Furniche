'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Entry } from '@/components/sky/SkyView';
import { Button } from '@/components/ui/button';
import BedsFilter from '@/components/home/BedsFilter';
import LocationFilter from '@/components/home/LocationFilter';
import PriceFilter, { NO_PRICE, inRange, type PriceRange } from '@/components/home/PriceFilter';
import { useFinance } from '@/components/finance/useFinance';
import { LogoMark } from '@/components/ui/Brand';
import { Input } from '@/components/ui/input';
import { toggleVariants } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { type BedFilter, inBeds, NO_BEDS } from '@/lib/beds';
import { getEntry, preloadEntry } from '@/lib/entryCache';
import { FEATURED, featuredOnTop } from '@/lib/featured';
import { loadFavorites, saveFavorites } from '@/lib/favorites';
import { useViewerState } from '@/lib/sceneBridge';
import { useOnMesh } from '@/lib/coverage';
import type { SearchResult } from '@/lib/search';
import { VERDICT_LABEL, buyVerdict, ownCost, rentVerdict, usd, type Verdict } from '@/lib/homeFinance';

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
const FLY_GIVE_UP_MS = 45000; // a typed /space link waits this long for the city before opening the tour directly

// Quick filters, each a plain-language search. The first one is the default (all apartments);
// it is labelled "Filters".
const PILLS: { label: string; q: string }[] = [
  { label: 'Filters', q: 'apartments' },
  { label: 'Studios', q: 'studio apartments' },
  { label: '1 bed', q: '1 bed apartments' },
  { label: '2 beds', q: '2 bed apartments' },
  { label: '3+ beds', q: '3+ bed apartments' },
  { label: 'Under $1,000', q: 'apartments under $1,000' },
  { label: 'Under $1,500', q: 'apartments under $1,500' },
  { label: 'The Heights', q: 'apartments in the Heights' },
  { label: 'Downtown', q: 'apartments in Downtown' },
];
const PAGE = 24;
const MAX_PINS = 250;
const thumb = (sid: string) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=640`;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const VERDICT_DOT: Record<Verdict, string> = { comfortable: 'bg-ok', stretch: 'bg-warn', over: 'bg-bad' };

function Card({
  r,
  money,
  active,
  saved,
  onToggleSave,
  onHover,
  onBroken,
  onOpen,
}: {
  r: SearchResult;
  money?: { monthly: number; verdict: Verdict } | null; // with the mover's Capital One accounts
  active: boolean;
  saved: boolean; // the heart is filled
  onToggleSave: () => void;
  onHover: (sid: string | null) => void;
  onBroken: () => void;
  onOpen?: () => void; // fly in from the 3D city instead of a plain page load
}) {
  const [amount, unit] = r.rent ? [r.priceLabel.replace('/mo', ''), 'total'] : [r.priceLabel, 'for sale'];
  return (
    // The wrapper carries the hover handlers and the heart, which sits over the photo's top-right
    // corner; a button cannot live inside the Link without being invalid HTML.
    <div className="relative" onMouseEnter={() => onHover(r.sid)} onMouseLeave={() => onHover(null)}>
      <Link
        href={`/space/${r.sid}`}
        className="group block"
        onClick={(e) => {
          if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          onOpen();
        }}
      >
        <div className={`relative aspect-[20/19] overflow-hidden rounded-xl bg-panel ring-2 transition ${active ? 'ring-brand' : 'ring-transparent'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb(r.sid)} alt="" loading="lazy" onError={onBroken} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
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
      {money && (
        <Link href={`/finance/${r.sid}`} className="mt-1 flex items-center gap-1.5 text-sm text-muted hover:text-ink" title="Costs, mortgage and move-in with Capital One">
          <span className={`h-2 w-2 rounded-full ${VERDICT_DOT[money.verdict]}`} />
          {!r.rent && <span className="num">≈ {usd(money.monthly)}/mo ·</span>}
          {VERDICT_LABEL[money.verdict]} <span aria-hidden>›</span>
        </Link>
      )}
      <button
        type="button"
        onClick={onToggleSave}
        aria-pressed={saved}
        aria-label={saved ? 'Remove from favourites' : 'Save to favourites'}
        className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-white transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
          <path
            d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"
            fill={saved ? '#fc7249' : 'rgba(0,0,0,0.4)'}
            stroke={saved ? '#fc7249' : '#fff'}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

// Search, quick filters and listings beside the live 3D city, Airbnb-style: hover a listing
// and the camera flies to it; click a pin or a card to walk through the home.
export default function HomeExplorer({ initial, fly }: { initial: Response & { q: string }; fly?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial.q);
  const [draft, setDraft] = useState(initial.q);
  const [data, setData] = useState<Response | null>(initial);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [price, setPrice] = useState<PriceRange>(NO_PRICE);
  const [beds, setBeds] = useState<BedFilter>(NO_BEDS);
  // The map's expand button: the listing column is hidden and the map takes the full width.
  const [wide, setWide] = useState(false);
  // Hearted listings, remembered in this browser. They are read after the first paint so the
  // server and browser render the same page.
  const [favs, setFavs] = useState<Set<string>>(new Set());
  useEffect(() => setFavs(loadFavorites()), []);
  const toggleFav = (sid: string) => {
    const next = new Set(favs);
    if (!next.delete(sid)) next.add(sid);
    setFavs(next);
    saveFavorites(next);
  };
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

  const available = useMemo(() => (data?.results ?? []).filter((r) => !broken.has(r.sid)), [data, broken]);
  // What each listing would cost the mover a month, and whether they can afford it (Capital One).
  const [fin] = useFinance();
  const [affordable, setAffordable] = useState(false);
  const moneyOf = useMemo(() => {
    const seen = new Map<string, { monthly: number; verdict: Verdict } | null>();
    return (r: SearchResult) => {
      if (!fin || r.price == null) return null;
      if (!seen.has(r.sid)) {
        if (r.rent) seen.set(r.sid, { monthly: r.price, verdict: rentVerdict(fin.profile, r.price).verdict });
        else {
          const c = ownCost({ price: r.price, downPct: 0.1, ratePct: fin.rates.rate30, years: 30, lon: r.lon });
          seen.set(r.sid, { monthly: c.monthly, verdict: buyVerdict(fin.profile, c).verdict });
        }
      }
      return seen.get(r.sid)!;
    };
  }, [fin]);
  const prices = useMemo(() => available.map((r) => r.price).filter((p): p is number => p != null), [available]);
  // The Price and Beds tabs narrow whatever the current search returned.
  const results = useMemo(
    () => available.filter((r) => inRange(r.price, price) && inBeds(r.beds, beds.range) && (!affordable || (moneyOf(r)?.verdict ?? 'over') !== 'over')),
    [available, price, beds, affordable, moneyOf],
  );
  const onMesh = useOnMesh();
  const inCity = useMemo(() => results.filter(onMesh).slice(0, MAX_PINS), [results, onMesh]);
  // The featured home is drawn last, so its pin sits on top, and starred.
  const pins = useMemo(() => featuredOnTop(inCity.map((r) => ({ sid: r.sid, lat: r.lat, lon: r.lon, label: r.sid === FEATURED.sid ? `★ ${r.priceLabel}` : r.priceLabel }))), [inCity]);
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
  // The Location tab searches "apartments in <place>". It shows as active only for a place typed
  // there; the quick-filter pills (The Heights, Downtown) keep their own highlight.
  const location = useMemo(() => (PILLS.some((p) => p.q === q) ? '' : (q.match(/^apartments in (.+)$/i)?.[1] ?? '')), [q]);
  const applyLocation = (place: string) => choose(place ? `apartments in ${place}` : PILLS[0].q);
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
  // The list heading is "<number> <what was searched>", e.g. "1,707 Apartments in Houston".
  const heading = data?.summary || 'Houston listings';
  // The server total, unless Price or Beds narrow the list: then the count of what is shown.
  const narrowed = price.min != null || price.max != null || beds.range != null;
  const count = narrowed ? results.length : (data?.total ?? 0);

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

  // Opened by address (/space/<id> redirects here with ?fly=<id>): fly into that home once the
  // city has drawn, as if its pin had been picked.
  const flown = useRef(false);
  // If the city never gets going (slow tiles), open the tour directly rather than wait forever.
  useEffect(() => {
    if (!fly) return;
    const t = setTimeout(() => {
      if (!flown.current) router.replace(`/space/${fly}?direct=1`);
    }, FLY_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [fly, router]);
  useEffect(() => {
    if (!fly || flown.current || !ready || entering) return;
    const r = results.find((x) => x.sid === fly);
    if (!r || !pinned.has(fly)) return;
    flown.current = true;
    enter(r);
  }, [fly, ready, entering, results, pinned]); // eslint-disable-line react-hooks/exhaustive-deps
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
            <div className="flex items-center justify-center gap-3 font-display text-3xl font-bold tracking-tight">
              <LogoMark size={36} />
              FurNiche AI
            </div>
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
          {/* Search: shadcn Input + Button. */}
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
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="3 bed apartments under $2,000"
                aria-label="Search homes and apartments"
                className="h-auto rounded-none border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0 md:text-sm"
              />
            </label>
            {/* The round orange search button, inside the bar on the right. */}
            <Button type="submit" size="icon" aria-label="Search" className="h-11 w-11 shrink-0 rounded-full">
              <svg viewBox="0 0 24 24" aria-hidden>
                <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="3" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            </Button>
          </form>
          {/* Quick filters: a single-choice shadcn ToggleGroup. */}
          <ToggleGroup
            type="single"
            value={PILLS.slice(1).some((p) => p.q === q) ? q : ''}
            onValueChange={(v) => v && choose(v)}
            className="scroll-thin max-w-full justify-start gap-2 overflow-x-auto pb-1"
          >
            {/* "Filters" is a plain button with the sliders icon, not a selectable tab: it clears the
                price range and goes back to the default search, all apartments. */}
            <button
              type="button"
              onClick={() => {
                setPrice(NO_PRICE);
                setBeds(NO_BEDS);
                choose(PILLS[0].q);
              }}
              className={cn(toggleVariants({ variant: 'outline' }), 'shrink-0 rounded-full border-transparent px-4 shadow-none')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
                <circle cx="15" cy="8" r="2" />
                <circle cx="9" cy="16" r="2" />
              </svg>
              Filters
            </button>
            {/* Location and Beds open text boxes and Price a slider box; they come right after Filters. */}
            <LocationFilter value={location} onApply={applyLocation} />
            <BedsFilter value={beds} onChange={setBeds} />
            <PriceFilter prices={prices} value={price} onChange={setPrice} />
            {fin && (
              <button
                type="button"
                aria-pressed={affordable}
                onClick={() => setAffordable((a) => !a)}
                title="Homes your Capital One accounts can cover: within budget or a stretch"
                className={cn(toggleVariants({ variant: 'outline' }), 'shrink-0 rounded-full px-4', affordable && 'border-foreground bg-foreground font-semibold text-background')}
              >
                Affordable for me
              </button>
            )}
            {PILLS.slice(1).map((p) => (
              <ToggleGroupItem
                key={p.q}
                value={p.q}
                variant="outline"
                className="shrink-0 rounded-full px-4 data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:font-semibold data-[state=on]:text-background"
              >
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div
        className={`mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-6 ${wide ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]'}`}
      >
        {/* The 3D city: first on phones, a sticky panel beside the list on wide screens. */}
        {/* A sticky element confines its children's z-index, so the panel itself must rise above
            the editor layer while flying in. */}
        <div
          ref={panel}
          className={`relative lg:sticky lg:top-[136px] lg:order-2 lg:h-[calc(100vh-160px)] ${wide ? 'h-[calc(100vh-160px)]' : 'h-[55vh]'}`}
          style={{ zIndex: frame && !inside ? 70 : undefined, pointerEvents: inside ? 'none' : undefined }}
        >
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
                mapControls
                expanded={wide}
                onToggleExpand={() => setWide((w) => !w)}
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

        <div className={`lg:order-1 ${wide ? 'hidden' : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h2 className="font-display text-2xl">
              {data ? `${count.toLocaleString()}${/^\d/.test(heading) ? ' · ' : ' '}${heading}` : 'Searching…'}
              {loading && <span className="ml-2 text-sm font-normal text-muted">updating…</span>}
            </h2>
            <p className="flex shrink-0 items-center gap-2.5 text-sm font-semibold">
              <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden className="text-brand">
                <path
                  d="M4 5a1 1 0 0 1 1-1h10.2a2 2 0 0 1 1.4.6l12 12a2 2 0 0 1 0 2.8l-8.4 8.4a2 2 0 0 1-2.8 0l-12-12A2 2 0 0 1 4 15.2z"
                  fill="currentColor"
                />
                <circle cx="10" cy="10" r="2.2" className="fill-paper" />
              </svg>
              Prices include all fees
            </p>
          </div>

          {data && !results.length && <p className="mt-10 text-sm text-muted">No listings match. Try another search or a quick filter.</p>}
          <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2">
            {results.slice(0, limit).map((r) => (
              <Card
                key={r.sid}
                r={r}
                money={moneyOf(r)}
                active={hover === r.sid}
                saved={favs.has(r.sid)}
                onToggleSave={() => toggleFav(r.sid)}
                onHover={hoverCard}
                onBroken={() => setBroken((b) => new Set(b).add(r.sid))}
                onOpen={pinned.has(r.sid) ? () => enter(r) : undefined}
              />
            ))}
          </div>
          {results.length > limit && (
            <div className="mt-10">
              <button onClick={() => setLimit((n) => n + PAGE)} className="w-full rounded-lg border border-ink/30 px-6 py-3 text-sm font-semibold transition hover:border-ink/50 hover:bg-card">
                Show more
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
