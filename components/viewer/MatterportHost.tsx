'use client';
import '@matterport/webcomponent';
import { MatterportViewer, type MpSdk } from '@matterport/r3f';
import { useEffect, useRef, useState } from 'react';
import { centroid } from '@/lib/geometry';
import { fromThree } from '@/lib/coords';
import { roomAt } from '@/lib/fit';
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

function startPano(geometry: ModelGeometry): string | null {
  const living = [...geometry.rooms].sort((a, b) => {
    const pri = (l: string) => (/living/i.test(l) ? 2 : /family|great|dining/i.test(l) ? 1 : 0);
    return pri(b.label) - pri(a.label) || b.areaM2 - a.areaM2;
  })[0];
  if (!living) return geometry.panos[0]?.id ?? null;
  const c = centroid(living.polygon);
  let best: string | null = null;
  let bd = Infinity;
  for (const p of geometry.panos) {
    const dd = Math.hypot(p.pos.x - c.x, p.pos.y - c.y);
    if (dd < bd) {
      bd = dd;
      best = p.id;
    }
  }
  return best;
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

export default function MatterportHost({ sid, geometry }: { sid: string; geometry: ModelGeometry | null }) {
  // A fresh <matterport-viewer> recovers from a failed boot; bumping the key remounts it.
  const [attempt, setAttempt] = useState(0);
  const vref = useRef<any>(null);
  const viewsRef = useRef<{ base: any; defurnish: any }>({ base: null, defurnish: null });
  const showFurnished = useStore((s) => s.showFurnished);
  const setPartial = useViewerState((s) => s.setPartial);
  const geomRef = useRef(geometry);
  geomRef.current = geometry;

  useEffect(() => () => setPartial({ sdk: null, ready: false, currentRoomId: null }), [setPartial]);

  const attemptRef = useRef(0);
  function remount() {
    if (attemptRef.current >= MAX_REMOUNTS) return;
    attemptRef.current += 1;
    viewsRef.current = { base: null, defurnish: null };
    setPartial({ sdk: null, ready: false, currentRoomId: null });
    setAttempt(attemptRef.current);
  }

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
    s.View.views.subscribe({
      onCollectionUpdated(views: Record<string, any>) {
        const list = Object.values(views);
        viewsRef.current.defurnish = list.find((v: any) => v.type === s.View.ViewType.DEFURNISH) ?? null;
        viewsRef.current.base = list.find((v: any) => v.type !== s.View.ViewType.DEFURNISH) ?? null;
        setPartial({ hasDefurnish: !!viewsRef.current.defurnish });
      },
    });

    // Wait for sweeps and geometry, then go inside.
    await new Promise<void>((res) =>
      s.Sweep.data.subscribe({ onCollectionUpdated: (c: Record<string, unknown>) => Object.keys(c).length && res() }),
    );
    for (let i = 0; i < 40 && !geomRef.current; i++) await new Promise((r) => setTimeout(r, 250));
    const target = geomRef.current ? startPano(geomRef.current) : null;
    // Pano tiles can be slow when Matterport is under load, so retry for ~20 s, then let
    // Showcase pick its own way inside rather than leaving the user in the dollhouse.
    const inside = target ? await moveToPano(s, target, true, 16) : false;
    if (!inside) await s.Mode.moveTo(s.Mode.Mode.INSIDE).catch(() => {});
    hideLoading(vref.current);
    setTimeout(() => hideLoading(vref.current), 1500);

    const defurn = viewsRef.current.defurnish;
    if (defurn && !useStore.getState().showFurnished) await defurn.setActive().catch(() => {});

    s.Sweep.current.subscribe((sw: any) => {
      if (!sw?.position || !geomRef.current) return;
      const p = fromThree(sw.position.x, sw.position.y, sw.position.z);
      const room = roomAt(p, geomRef.current.rooms);
      const floor = geomRef.current.floors.reduce(
        (best, f) => (f.z <= p.z && (best === null || f.z > best.z) ? f : best),
        null as null | { z: number },
      );
      setPartial({ currentRoomId: room?.id ?? null, cameraFloorZ: floor?.z ?? 0 });
    });
    setPartial({ ready: true });
  }

  useEffect(() => {
    const { base, defurnish } = viewsRef.current;
    const target = showFurnished ? base : defurnish;
    if (target && !target.active) target.setActive().catch(() => {});
  }, [showFurnished]);

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
