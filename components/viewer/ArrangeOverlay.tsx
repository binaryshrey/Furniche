'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { toThree } from '@/lib/coords';
import { checkFit, roomAt } from '@/lib/fit';
import { bridge, raycast, useGhost, useViewerState } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { FitLevel, ModelGeometry, PlacedItem, Product, Vec2, Vec3 } from '@/lib/types';

const LEVEL_TEXT: Record<FitLevel, string> = { ok: 'text-ok', warn: 'text-warn', error: 'text-bad' };

type Gesture =
  | { kind: 'move'; uid: string; offset: Vec2 }
  | { kind: 'rotate'; uid: string; startAngle: number; startRot: number; center: Vec2 };

// Furniture interaction over the Matterport viewer. It never blocks the scan while idle: a
// capture-phase listener grabs a press only when it lands on a piece, so walking and looking
// around keep working. A full-screen layer appears only while dropping a product, while a
// gesture is in progress, or in Arrange mode (which deliberately turns walking off).
export default function ArrangeOverlay({ geometry }: { geometry: ModelGeometry | null }) {
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLDivElement>(null);
  const mode = useStore((s) => s.mode);
  const pending = useStore((s) => s.pendingProductId);
  const selected = useStore((s) => s.selectedUid);
  const productOf = useStore((s) => s.product);
  const design = useDesign();
  const setGhost = useGhost((s) => s.setGhost);
  const [gesture, setGesture] = useState<Gesture['kind'] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const enteredWhilePressed = useRef(false);

  const designRef = useRef(design);
  designRef.current = design;

  const rect = () => root.current?.getBoundingClientRect() ?? null;
  const inside = (e: { clientX: number; clientY: number }) => {
    const r = rect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const ndcOf = (e: { clientX: number; clientY: number }) => {
    const r = rect()!;
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  };
  const floorZ = () => useViewerState.getState().cameraFloorZ;
  const roomIdAt = (p: Vec3) => (geometry ? roomAt(p, geometry.rooms)?.id ?? null : null);
  const floorPoint = (e: { clientX: number; clientY: number }) => {
    const hit = raycast(ndcOf(e), floorZ(), false);
    return hit?.kind === 'floor' ? hit.point : null;
  };

  // Fit issues for the selected piece, shown in a label that floats next to it.
  const resolved = useMemo(
    () =>
      design.items
        .map((item) => ({ item, product: productOf(item.productId) }))
        .filter((x): x is { item: PlacedItem; product: Product } => !!x.product),
    [design.items, productOf],
  );
  const issues = useMemo(() => checkFit(resolved, geometry?.rooms ?? [], design.doors, geometry?.walls), [resolved, geometry, design.doors]);
  const sel = resolved.find((r) => r.item.uid === selected) ?? null;
  const selIssues = issues.filter((i) => i.uid === selected);

  function startGesture(g: Gesture) {
    gestureRef.current = g;
    setGesture(g.kind);
    const move = (e: PointerEvent) => {
      const cur = gestureRef.current;
      const p = floorPoint(e);
      const it = designRef.current.items.find((i) => i.uid === cur?.uid);
      if (!cur || !p || !it) return;
      if (cur.kind === 'move') {
        const pos = { x: p.x + cur.offset.x, y: p.y + cur.offset.y, z: it.pos.z };
        useStore.getState().moveItem(cur.uid, pos, roomIdAt(pos));
      } else {
        let rot = cur.startRot + Math.atan2(p.y - cur.center.y, p.x - cur.center.x) - cur.startAngle;
        if (e.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
        useStore.getState().rotateItem(cur.uid, rot - it.rot);
      }
    };
    const up = () => {
      gestureRef.current = null;
      setGesture(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startRotate(uid: string, e: { clientX: number; clientY: number }) {
    const it = designRef.current.items.find((i) => i.uid === uid);
    const p = floorPoint(e);
    if (!it || !p) return;
    startGesture({ kind: 'rotate', uid, center: it.pos, startRot: it.rot, startAngle: Math.atan2(p.y - it.pos.y, p.x - it.pos.x) });
  }

  // A flat rug covers the floor you'd click to walk, so it only catches presses once it's selected
  // (or in Arrange mode); otherwise the press walks, like clicking the bare floor.
  const walkable = (uid: string) => {
    const st = useStore.getState();
    if (st.selectedUid === uid || st.mode === 'arrange') return false;
    const it = designRef.current.items.find((i) => i.uid === uid);
    return it ? st.product(it.productId)?.category === 'rug' : false;
  };

  // Grab furniture without blocking the scan: capture phase runs before Matterport's handlers.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !inside(e) || useStore.getState().pendingProductId) return;
      if ((e.target as HTMLElement)?.closest?.('[data-fn-ui]')) return;
      const hit = raycast(ndcOf(e), floorZ(), true);
      if (hit?.kind !== 'item' || walkable(hit.uid)) {
        if (useStore.getState().mode !== 'door') useStore.getState().select(null);
        return; // let Matterport walk / look around
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      const st = useStore.getState();
      // Only the selected piece (or any piece in Arrange mode) moves. Pressing on another piece
      // selects it on click, and a drag across it turns the camera like dragging anywhere else,
      // so looking around a furnished room never shuffles the furniture. With the furniture
      // locked nothing moves: every drag looks around and a click just selects (to swap it).
      const locked = !!st.design().locked;
      if (locked || (st.selectedUid !== hit.uid && st.mode !== 'arrange' && !e.altKey)) return lookOrSelect(hit.uid, e);
      st.select(hit.uid);
      if (e.altKey) return startRotate(hit.uid, e);
      const it = designRef.current.items.find((i) => i.uid === hit.uid);
      const p = floorPoint(e);
      if (it && p) startGesture({ kind: 'move', uid: hit.uid, offset: { x: it.pos.x - p.x, y: it.pos.y - p.y } });
    };

    // A press on an unselected piece: a click selects it; a drag turns Matterport's camera.
    const lookOrSelect = (uid: string, e: PointerEvent) => {
      const sdk = useViewerState.getState().sdk;
      let last = { x: e.clientX, y: e.clientY };
      let moved = 0;
      let pending = { h: 0, v: 0 };
      let busy = false;
      const flush = () => {
        if (busy || !sdk || (!pending.h && !pending.v)) return;
        busy = true;
        const { h, v } = pending;
        pending = { h: 0, v: 0 };
        Promise.resolve(sdk.Camera.rotate(h, v, { speed: 360 }))
          .catch(() => {})
          .finally(() => {
            busy = false;
            flush();
          });
      };
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - last.x;
        const dy = ev.clientY - last.y;
        last = { x: ev.clientX, y: ev.clientY };
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved < 6) return;
        // Grab-the-scene feel, matching Matterport's own drag: drag right looks left.
        pending.h += -dx * 0.12;
        pending.v += dy * 0.12;
        flush();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved < 6) useStore.getState().select(uid);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    // Over furniture: an open hand (pick up), and Matterport's walking circle hidden so the two
    // don't compete. While dragging: a closed hand. Rugs you aren't moving stay walkable.
    let raf = 0;
    let lastOver: boolean | null = null;
    const setCursor = (c: string) => {
      const host = root.current?.parentElement;
      if (!host) return;
      host.style.cursor = c;
      host.querySelectorAll<HTMLElement>('matterport-viewer, canvas').forEach((el) => (el.style.cursor = c));
    };
    const hover = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (gestureRef.current) return setCursor('grabbing');
        const hit = !useStore.getState().pendingProductId && inside(e) ? raycast(ndcOf(e), floorZ(), true) : null;
        const over = hit?.kind === 'item' && !walkable(hit.uid);
        setCursor(over ? (useStore.getState().design().locked ? 'pointer' : 'grab') : '');
        if (over !== lastOver) {
          lastOver = over;
          useViewerState.getState().sdk?.Pointer?.setVisible?.(!over)?.catch?.(() => {});
        }
      });
    };
    const wheel = (e: WheelEvent) => {
      const st = useStore.getState();
      if (!e.shiftKey || !st.selectedUid || !inside(e) || st.design().locked) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      st.rotateItem(st.selectedUid, Math.sign(e.deltaY || e.deltaX) * (Math.PI / 24));
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', hover);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', hover);
      window.removeEventListener('wheel', wheel, true);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry]);

  // Dropping a product from the shop. Release on the floor places it; release anywhere else
  // after dragging into the scene cancels, so the editor never stays stuck in drop mode.
  // A plain click on a shop card keeps the product picked until the floor is clicked.
  useEffect(() => {
    if (!pending) {
      setGhost(null);
      setHint(null);
      return;
    }
    enteredWhilePressed.current = false;
    setHint('Release on the floor to place · R rotates · Esc cancels');
    const move = (e: PointerEvent) => {
      if (!inside(e)) return setGhost(null);
      if (e.buttons) enteredWhilePressed.current = true;
      const p = floorPoint(e);
      if (p) setGhost({ productId: pending, pos: { ...p, z: floorZ() }, rot: useGhost.getState().ghost?.rot ?? 0 });
      else setGhost(null);
    };
    const up = (e: PointerEvent) => {
      const st = useStore.getState();
      if (!inside(e)) {
        if (enteredWhilePressed.current) st.setPending(null);
        return;
      }
      const g = useGhost.getState().ghost;
      if (g) {
        st.addItem(g.productId, g.pos, roomIdAt(g.pos), g.rot);
        st.setPending(null);
      } else {
        st.setPending(null);
        setHint(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, geometry]);

  // Keyboard shortcuts.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const st = useStore.getState();
      const s = st.selectedUid;
      if (e.key === 'Escape') {
        st.setPending(null);
        st.select(null);
      }
      if (e.key === 'r' || e.key === 'R') {
        const step = (e.shiftKey ? -1 : 1) * (Math.PI / 12);
        if (st.pendingProductId) {
          const g = useGhost.getState().ghost;
          if (g) setGhost({ ...g, rot: g.rot + step });
        } else if (s && !st.design().locked) st.rotateItem(s, step);
      }
      if (!s || st.design().locked) return;
      if (e.key === 'Delete' || e.key === 'Backspace') st.removeItem(s);
      if (e.key === 'd' || e.key === 'D') st.duplicateItem(s);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setGhost]);

  // Keep the rotate handle and issue label pinned to the selected piece as the camera moves.
  useEffect(() => {
    if (!sel) return;
    const v = new THREE.Vector3();
    let raf = 0;
    const place = (el: HTMLElement | null, p: Vec3) => {
      const r = rect();
      const cam = bridge.camera;
      if (!el || !r || !cam) return;
      v.set(...toThree(p)).project(cam);
      const visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.display = visible ? '' : 'none';
      el.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px)`;
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const it = designRef.current.items.find((i) => i.uid === sel.item.uid);
      if (!it) return;
      // The handle sits just off one side of the piece: the front (local -y at rot 0) when it is
      // on screen, otherwise whichever side is closest to the middle of the view.
      const reach = Math.max(sel.product.dimsCm.w, sel.product.dimsCm.d) / 200 + 0.35;
      const cam = bridge.camera;
      let best: Vec3 | null = null;
      let bestScore = Infinity;
      for (const [i, a] of [0, Math.PI, Math.PI / 2, -Math.PI / 2].entries()) {
        const p = { x: it.pos.x + Math.sin(it.rot + a) * reach, y: it.pos.y - Math.cos(it.rot + a) * reach, z: it.pos.z };
        if (!cam) break;
        v.set(...toThree(p)).project(cam);
        if (v.z >= 1 || Math.abs(v.x) > 0.9 || Math.abs(v.y) > 0.9) continue;
        const score = Math.hypot(v.x, v.y + 0.3) + i * 0.15; // slight preference for the front
        if (score < bestScore) [best, bestScore] = [p, score];
      }
      if (best) place(handle.current, best);
      else if (handle.current) handle.current.style.display = 'none';
      place(label.current, { x: it.pos.x, y: it.pos.y, z: it.pos.z + sel.product.dimsCm.h / 100 + 0.15 });
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.item.uid, sel?.product.id]);

  const blocking = !!pending || !!gesture || mode === 'arrange';
  const worst: FitLevel = selIssues.some((i) => i.level === 'error') ? 'error' : selIssues.length ? 'warn' : 'ok';

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {blocking && (
        <div
          className="pointer-events-auto absolute inset-0"
          style={{ cursor: pending ? 'copy' : gesture === 'move' ? 'grabbing' : gesture === 'rotate' ? 'alias' : 'default', touchAction: 'none' }}
          onPointerDown={(e) => {
            // Arrange mode: presses on empty floor deselect instead of walking.
            if (pending || gesture) return;
            const hit = raycast(ndcOf(e), floorZ(), true);
            if (hit?.kind !== 'item') useStore.getState().select(null);
          }}
        />
      )}

      {sel && !pending && !design.locked && (
        <>
          <button
            ref={handle}
            data-fn-ui
            title="Drag around the piece to rotate · Shift snaps to 15°"
            aria-label="Rotate"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startRotate(sel.item.uid, e);
            }}
            className="pointer-events-auto absolute left-0 top-0 -ml-4 -mt-4 grid h-8 w-8 cursor-alias place-items-center rounded-full border border-white/70 bg-paper/90 text-ink shadow-swatch transition-colors hover:bg-ink hover:text-paper"
            style={{ display: 'none' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
            </svg>
          </button>
          <div ref={label} className="absolute left-0 top-0" style={{ display: 'none' }}>
            <div className="-translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-paper/90 px-2.5 py-1.5 text-xs shadow-swatch backdrop-blur">
              <div className="font-semibold">{sel.product.name.split(',')[0]}</div>
              {selIssues.length ? (
                selIssues.slice(0, 2).map((i) => (
                  <div key={i.message} className={LEVEL_TEXT[i.level]}>
                    {i.message}
                  </div>
                ))
              ) : (
                <div className={LEVEL_TEXT[worst]}>Fits here</div>
              )}
            </div>
          </div>
        </>
      )}

      {hint && pending && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-paper/90 px-4 py-1.5 text-xs shadow-swatch">{hint}</div>
      )}
    </div>
  );
}
