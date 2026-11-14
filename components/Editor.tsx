'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { panoForRoom } from '@/lib/fit';
import { useViewerState } from '@/lib/sceneBridge';
import { useStore } from '@/lib/store';
import type { Design, Listing, ModelGeometry } from '@/lib/types';
import ArrangeOverlay from './viewer/ArrangeOverlay';
import TourCover from './viewer/TourCover';
import DesignPanel from './design/DesignPanel';
import PlanView from './plan/PlanView';
import { fmtUsd } from './shop/ShopPanel';
import SwapCard from './design/SwapCard';
import { Logo } from './ui/Brand';

const MatterportHost = dynamic(() => import('./viewer/MatterportHost'), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted">Loading the 3D tour…</div>,
});

export default function Editor({ sid }: { sid: string }) {
  const [geometry, setGeometry] = useState<ModelGeometry | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'3d' | 'plan'>('3d');
  const [copied, setCopied] = useState(false);
  const setActive = useStore((s) => s.setActive);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const showFurnished = useStore((s) => s.showFurnished);
  const setShowFurnished = useStore((s) => s.setShowFurnished);
  const { sdk, ready, hasDefurnish, currentRoomId, embedOnly } = useViewerState();
  const locked = useStore((s) => !!(s.activeSid && s.designs[s.activeSid]?.locked));

  useEffect(() => {
    setActive(sid);
    // A shared design arrives in the URL hash.
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('d')) {
      try {
        const d = JSON.parse(decompressFromEncodedURIComponent(hash.slice(1)) ?? '') as Design;
        if (d?.sid === sid) useStore.getState().loadDesign(d);
      } catch {
        /* ignore bad links */
      }
    }
    fetch(`/api/models/${sid}`)
      .then((r) => r.json())
      .then((g) => (g.error ? setError(g.error) : setGeometry(g)))
      .catch(() => setError('Could not load the scan.'));
    fetch('/api/listings')
      .then((r) => r.json())
      .then((d) => setListing([...(d.homes ?? []), ...(d.apartments ?? [])].find((l: Listing) => l.sid === sid) ?? null))
      .catch(() => {});
  }, [sid, setActive]);

  async function goToRoom(roomId: string) {
    const room = geometry?.rooms.find((r) => r.id === roomId);
    if (!room || !geometry || !sdk) return;
    const pano = panoForRoom(room, geometry.panos);
    if (pano) {
      const { moveToPano } = await import('./viewer/MatterportHost');
      moveToPano(sdk, pano.id);
    }
  }

  function share() {
    const d = useStore.getState().design();
    const url = `${location.origin}${location.pathname}#d${compressToEncodedURIComponent(JSON.stringify(d))}`;
    navigator.clipboard?.writeText(url).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1800)),
      () => window.prompt('Copy this link', url),
    );
  }

  const title = listing ? (listing.kind === 'home' ? listing.address : `${listing.community ?? listing.address} · ${listing.unitName}`) : geometry?.name ?? sid;
  const facts =
    listing?.kind === 'home'
      ? [listing.price && fmtUsd(listing.price), listing.beds && `${listing.beds} bd`, listing.baths && `${listing.baths} ba`, listing.sqft && `${listing.sqft.toLocaleString()} sq ft`]
      : listing?.kind === 'apartment'
        ? [listing.rentMin && `${fmtUsd(listing.rentMin)}–${fmtUsd(listing.rentMax ?? listing.rentMin)}/mo`, listing.unitName]
        : [];
  const rooms = (geometry?.rooms ?? []).filter((r) => !/closet|hallway|bathroom|void/i.test(r.label) && r.areaM2 > 4);

  return (
    <div
      className="flex h-screen flex-col"
      onClickCapture={(e) => {
        // Leave the editor with a full page load. Unmounting Showcase client-side makes it throw
        // from its own async teardown ("No Data was registered to the Module").
        const a = (e.target as HTMLElement).closest('a');
        const href = a?.getAttribute('href');
        if (!href?.startsWith('/') || a?.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        window.location.assign(href);
      }}
    >
      <header className="flex items-center gap-4 border-b border-line bg-paper px-4 py-2">
        <Logo />
        <div className="min-w-0 border-l border-line pl-4">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="truncate text-xs text-muted">{facts.filter(Boolean).join(' · ') || 'Houston'}</div>
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Link href="/explore" className="rounded-md px-2 py-1 hover:bg-card">
            All homes
          </Link>
          {listing?.kind === 'home' && (
            <Link href={`/outside/${listing.listingId}?sid=${sid}`} className="rounded-md px-2 py-1 hover:bg-card">
              Plan the yard
            </Link>
          )}
          {/* Fly over this home in Vexcel's 3D Houston (empty query = every listing, this one first). */}
          <Link href={`/sky?q=&focus=${sid}`} className="rounded-md px-2 py-1 hover:bg-card">
            3D city
          </Link>
          <button onClick={share} className="rounded-md border border-line bg-card px-3 py-1.5">
            {copied ? 'Link copied' : 'Share design'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-3 py-2 text-xs">
            <div className="flex overflow-hidden rounded-md border border-line bg-card">
              {(['3d', 'plan'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? 'bg-ink text-paper' : ''}`}>
                  {v === '3d' ? '3D tour' : 'Floor plan'}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-md border border-line bg-card">
              <button onClick={() => setMode('navigate')} className={`px-3 py-1.5 ${mode === 'navigate' ? 'bg-ink text-paper' : ''}`} title="Click to walk through the home">
                Walk
              </button>
              <button onClick={() => setMode('arrange')} className={`px-3 py-1.5 ${mode === 'arrange' ? 'bg-ink text-paper' : ''}`} title="Click and drag furniture">
                Arrange
              </button>
              {view === 'plan' && (
                <button onClick={() => setMode(mode === 'door' ? 'navigate' : 'door')} className={`px-3 py-1.5 ${mode === 'door' ? 'bg-ink text-paper' : ''}`}>
                  Mark doors
                </button>
              )}
            </div>
            {hasDefurnish && (
              <label className="flex items-center gap-1.5 rounded-md border border-line bg-card px-2.5 py-1.5">
                <input id="toggle-furnished" type="checkbox" checked={showFurnished} onChange={(e) => setShowFurnished(e.target.checked)} className="accent-ink" />
                Show seller&apos;s furniture
              </label>
            )}
            <select
              id="room-picker"
              value={currentRoomId ?? ''}
              onChange={(e) => goToRoom(e.target.value)}
              className="rounded-md border border-line bg-card px-2 py-1.5"
              disabled={!ready}
            >
              <option value="" disabled>
                Go to room…
              </option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.areaM2.toFixed(0)} m²
                </option>
              ))}
            </select>
            <span className="ml-auto text-muted">{ready ? (locked ? 'Furniture locked · click the floor to walk, drag to look around · click a piece to swap it' : mode === 'arrange' ? 'Walking is off. Drag pieces to move, drag ↻ to rotate.' : 'Click the floor to walk · click a piece to select it, then drag it to move · drag ↻ to rotate') : embedOnly ? 'Walk-through tour · switch to Floor plan to furnish' : 'Connecting to Matterport…'}</span>
          </div>

          <div className="relative min-h-0 flex-1 bg-paper">
            {error && <div className="absolute inset-0 z-20 flex items-center justify-center text-sm text-bad">{error}</div>}
            <div className={view === '3d' ? 'absolute inset-0' : 'invisible absolute inset-0'}>
              <MatterportHost sid={sid} geometry={geometry} />
              <ArrangeOverlay geometry={geometry} />
              <SwapCard geometry={geometry} />
              <TourCover sid={sid} />
            </div>
            {view === 'plan' && geometry && (
              <div className="absolute inset-0 z-10">
                <PlanView geometry={geometry} />
              </div>
            )}
          </div>
        </main>

        <DesignPanel geometry={geometry} />
      </div>
    </div>
  );
}
