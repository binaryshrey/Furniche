'use client';
import '@matterport/webcomponent';
import { MatterportViewer, type MpSdk } from '@matterport/r3f';
import { useEffect, useRef, useState } from 'react';
import { fromThree } from '@/lib/coords';
import { rememberSkipped } from '@/lib/entrySkip';
import { entryPano, roomAt } from '@/lib/fit';
import { useViewerState } from '@/lib/sceneBridge';
import { useStore } from '@/lib/store';
import type { ModelGeometry } from '@/lib/types';
import FurnitureLayer from './FurnitureLayer';

// Some models start on a drone exterior and never leave Matterport's loading screen inside
// the web component. We connect, move to an interior pano ourselves and hide the overlay.
function hideLoading(el: any) {
  const lg = el?.shadowRoot?.querySelector('#loading-gui') as HTMLElement | null;
  if (lg) lg.style.display = 'none';
}

const startPano = (geometry: ModelGeometry, skip?: ReadonlySet<string>) => entryPano(geometry, skip)?.id ?? null;

// Showcase throws these from its own async teardown whenever a viewer is unmounted while the page
// stays loaded: our remount after a failed boot, a Fast Refresh in development, or leaving the
// editor client-side. They are harmless (the old viewer is already gone), so keep them out of the
// console and the Next.js error overlay. Everything else still surfaces.
const TEARDOWN = /No Data was registered to the Module|module unloaded/i;
if (typeof window !== 'undefined' && !(window as any).__fnTeardownGuard) {
  (window as any).__fnTeardownGuard = true;
  const swallow = (e: ErrorEvent | PromiseRejectionEvent) => {
    const reason = 'reason' in e ? e.reason : e.error ?? e.message;
    const msg = typeof reason === 'string' ? reason : reason?.message ?? String(reason ?? '');
    if (!TEARDOWN.test(msg)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('error', swallow, true);
  window.addEventListener('unhandledrejection', swallow, true);
}

export async function moveToPano(sdk: any, panoId: string, instant = false, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      await sdk.Sweep.moveTo(panoId, { transition: instant ? sdk.Sweep.Transition.INSTANT : sdk.Sweep.Transition.FLY });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return false;
}

const MAX_REMOUNTS = 2;
const SDK_WAIT_MS = 12000;

export default function MatterportHost({ sid, geometry }: { sid: string; geometry: ModelGeometry | null }) {
  // A fresh <matterport-viewer> recovers from a failed boot; bumping the key remounts it.
  const [attempt, setAttempt] = useState(0);
  const vref = useRef<any>(null);
  const viewsRef = useRef<{ base: any; defurnish: any }>({ base: null, defurnish: null });
  const showFurnished = useStore((s) => s.showFurnished);
  const setPartial = useViewerState((s) => s.setPartial);
  const geomRef = useRef(geometry);
  geomRef.current = geometry;

  useEffect(() => () => setPartial({ sdk: null, ready: false, currentRoomId: null, showingRoom: false, embedOnly: false }), [setPartial]);

  const attemptRef = useRef(0);
  function remount() {
    if (attemptRef.current >= MAX_REMOUNTS) return;
    attemptRef.current += 1;
    viewsRef.current = { base: null, defurnish: null };
    setPartial({ sdk: null, ready: false, currentRoomId: null, showingRoom: false });
    setAttempt(attemptRef.current);
  }

  // The SDK key only allows certain domains (localhost here). On any other host, if the SDK
  // hasn't connected after a while, show Matterport's standard embedded tour instead: the home
  // can still be walked through, and furnishing works in the floor plan.
  const sdkReady = useViewerState((st) => !!st.sdk);
  const [embedOnly, setEmbedOnly] = useState(false);
  useEffect(() => {
    if (sdkReady || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) return;
    const t = setTimeout(() => {
      setEmbedOnly(true);
      setPartial({ showingRoom: true, embedOnly: true }); // reveal the tour (and let the sky crossfade finish)
    }, SDK_WAIT_MS);
    return () => clearTimeout(t);
  }, [sdkReady, sid, setPartial]);

  // A direct page load sometimes ends on Showcase's "model not available" screen while a
  // client-side navigation to the same model works. Watch for that screen and remount.
  // (Don't key off App.Phase.ERROR: drone-start models pass through it on a normal boot.)
  useEffect(() => {
    const id = setInterval(() => {
      const text = vref.current?.shadowRoot?.textContent ?? '';
      if (/model not available/i.test(text)) remount();
    }, 2000);
    return () => clearInterval(id);
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onConnected(sdk: MpSdk) {
    const s: any = sdk;
    setPartial({ sdk: s });
    let viewsSeen = false;
    s.View.views.subscribe({
      onCollectionUpdated(views: Record<string, any>) {
        const list = Object.values(views);
        viewsRef.current.defurnish = list.find((v: any) => v.type === s.View.ViewType.DEFURNISH) ?? null;
        viewsRef.current.base = list.find((v: any) => v.type !== s.View.ViewType.DEFURNISH) ?? null;
        setPartial({ hasDefurnish: !!viewsRef.current.defurnish });
        viewsSeen = true;
      },
    });

    // Wait for sweeps and geometry, then go inside.
    let sweeps: Record<string, any> = {};
    await new Promise<void>((res) =>
      s.Sweep.data.subscribe({
        onCollectionUpdated: (c: Record<string, any>) => {
          sweeps = c;
          if (Object.keys(c).length) res();
        },
      }),
    );
    for (let i = 0; i < 40 && !geomRef.current; i++) await new Promise((r) => setTimeout(r, 250));
    // Start only on a pano the tour can visit: some have photos but are disabled or unaligned.
    // Remember the rest so the sky-to-house flight picks its entry photo from the same set.
    const blocked = (geomRef.current?.panos ?? [])
      .map((p) => p.id)
      .filter((id) => !sweeps[id] || sweeps[id].enabled === false || (sweeps[id].alignmentType && sweeps[id].alignmentType !== 'aligned'));
    rememberSkipped(sid, blocked);
    const target = geomRef.current ? startPano(geomRef.current, new Set(blocked)) : null;
    for (let i = 0; i < 12 && !viewsSeen; i++) await new Promise((r) => setTimeout(r, 250));
    const wantEmpty = () => !!viewsRef.current.defurnish && !useStore.getState().showFurnished;
    const emptyActive = () => !wantEmpty() || !!viewsRef.current.defurnish?.active;
    // Switch to the empty (defurnished) view first: activating a view puts the camera back at
    // that view's own start, which would undo the move below.
    if (wantEmpty()) await viewsRef.current.defurnish.setActive().catch(() => {});
    // Pano tiles can be slow when Matterport is under load, so retry for ~20 s, then let
    // Showcase pick its own way inside rather than leaving the user in the dollhouse.
    const inside = target ? await moveToPano(s, target, true, 16) : false;
    if (!inside) await s.Mode.moveTo(s.Mode.Mode.INSIDE).catch(() => {});
    hideLoading(vref.current);
    setTimeout(() => hideLoading(vref.current), 1500);

    let currentSweep: any = null;
    s.Sweep.current.subscribe((sw: any) => {
      currentSweep = sw;
      if (!sw?.position || !geomRef.current) return;
      const p = fromThree(sw.position.x, sw.position.y, sw.position.z);
      const room = roomAt(p, geomRef.current.rooms);
      const floor = geomRef.current.floors.reduce(
        (best, f) => (f.z <= p.z && (best === null || f.z > best.z) ? f : best),
        null as null | { z: number },
      );
      setPartial({ currentRoomId: room?.id ?? null, cameraFloorZ: floor?.z ?? 0 });
    });
    // Face the way the sky-to-house flight ends: the front face of the start pano's 360° photo
    // (/api/models/[sid]/entry). A pano's photo is in its own frame; its front is the pano's
    // yaw minus 90°.
    const faceEntry = () => {
      const q = currentSweep?.rotation;
      if (!q) return Promise.resolve();
      const w = Math.sqrt(Math.max(0, 1 - q.x * q.x - q.y * q.y - q.z * q.z));
      const yaw = (2 * Math.atan2(q.y, w) * 180) / Math.PI;
      return s.Camera.setRotation({ x: 0, y: yaw - 90 }, { speed: 10000 }).catch(() => {});
    };

    // "Showing a room" (which the pages wait for before revealing the tour) only once the boot
    // has settled: empty view active, standing on the start pano, facing the entry direction.
    let mode = '';
    let onPano = false;
    let settled = false;
    const showing = () => setPartial({ showingRoom: settled && mode === s.Mode.Mode.INSIDE && onPano });
    s.Mode.current.subscribe((m: string) => {
      mode = m;
      showing();
    });
    s.Sweep.current.subscribe((sw: any) => {
      onPano = !!sw?.sid;
      showing();
    });
    setPartial({ ready: true });

    // Showcase sometimes lands on its own start pano, flips back to the furnished view, or
    // stays on the dollhouse (seen when the tour loads behind the 3D-city flight). Check and
    // correct once a second for up to ~12 s, then hand over whatever state it is in.
    for (let i = 0; i < 12; i++) {
      const onTarget = !target || currentSweep?.sid === target;
      if (mode === s.Mode.Mode.INSIDE && onPano && onTarget && emptyActive()) break;
      if (!emptyActive()) await viewsRef.current.defurnish.setActive().catch(() => {});
      const moved = target && !onTarget ? await moveToPano(s, target, true, 1) : onTarget;
      if (!moved) await s.Mode.moveTo(s.Mode.Mode.INSIDE).catch(() => {});
      hideLoading(vref.current);
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (target && currentSweep?.sid === target) await faceEntry();
    settled = true;
    showing();
  }

  useEffect(() => {
    const { base, defurnish } = viewsRef.current;
    const target = showFurnished ? base : defurnish;
    if (target && !target.active) target.setActive().catch(() => {});
  }, [showFurnished]);

  if (embedOnly) {
    return (
      <div className="relative h-full w-full">
        <iframe
          title="3D tour"
          src={`https://my.matterport.com/show/?m=${sid}&play=1&qs=1&brand=0&help=0`}
          allow="fullscreen; xr-spatial-tracking"
          className="h-full w-full border-0"
        />
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 max-w-[90%] -translate-x-1/2 rounded-full bg-paper/90 px-4 py-2 text-center text-xs text-muted backdrop-blur">
          Live furnishing in 3D runs on localhost for this demo. Walk the home here, and use Floor plan to furnish it.
        </div>
      </div>
    );
  }

  return (
    <MatterportViewer
      key={attempt}
      ref={vref}
      m={sid}
      assetBase="/matterport-assets/"
      applicationKey={process.env.NEXT_PUBLIC_MATTERPORT_SDK_KEY!}
      onConnected={onConnected}
      play="1"
      brand="0"
      help="0"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <FurnitureLayer geometry={geometry} />
    </MatterportViewer>
  );
}
