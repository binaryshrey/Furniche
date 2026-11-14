'use client';
import { useEffect, useRef } from 'react';
import { roomAt } from '@/lib/fit';
import { raycast, useGhost, useViewerState } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { ModelGeometry, Vec3 } from '@/lib/types';

// Transparent layer over the viewer. While active it takes pointer input away from
// Matterport (so clicks don't walk the camera) and places, selects and drags furniture.
export default function ArrangeOverlay({ geometry }: { geometry: ModelGeometry | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mode = useStore((s) => s.mode);
  const pending = useStore((s) => s.pendingProductId);
  const design = useDesign();
  const drag = useRef<{ uid: string; offset: { x: number; y: number } } | null>(null);
  const setGhost = useGhost((s) => s.setGhost);
  const active = mode === 'arrange' || !!pending;

  const ndcOf = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  };
  const inside = (e: { clientX: number; clientY: number }) => {
    const r = ref.current?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const floorZ = () => useViewerState.getState().cameraFloorZ;
  const roomIdAt = (p: Vec3) => (geometry ? roomAt(p, geometry.rooms)?.id ?? null : null);

  // Window-level listeners so a drag that starts on a shop card can drop into the scene.
  useEffect(() => {
    if (!pending) {
      setGhost(null);
      return;
    }
    const move = (e: PointerEvent) => {
      if (!inside(e)) return setGhost(null);
      const hit = raycast(ndcOf(e), floorZ(), false);
      if (hit?.kind === 'floor') setGhost({ productId: pending, pos: { ...hit.point, z: floorZ() }, rot: useGhost.getState().ghost?.rot ?? 0 });
    };
    const up = (e: PointerEvent) => {
      if (!inside(e)) return;
      const g = useGhost.getState().ghost;
      if (!g) return;
      useStore.getState().addItem(g.productId, g.pos, roomIdAt(g.pos), g.rot);
      useStore.getState().setPending(null);
      setGhost(null);
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
      const sel = st.selectedUid;
      if (e.key === 'Escape') {
        st.setPending(null);
        st.select(null);
      }
      if (e.key === 'r' || e.key === 'R') {
        const step = (e.shiftKey ? -1 : 1) * (Math.PI / 12);
        if (st.pendingProductId) {
          const g = useGhost.getState().ghost;
          if (g) setGhost({ ...g, rot: g.rot + step });
        } else if (sel) st.rotateItem(sel, step);
      }
      if (!sel) return;
      if (e.key === 'Delete' || e.key === 'Backspace') st.removeItem(sel);
      if (e.key === 'd' || e.key === 'D') st.duplicateItem(sel);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [setGhost]);

  if (!active) return null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10"
      style={{ cursor: pending ? 'copy' : drag.current ? 'grabbing' : 'default', touchAction: 'none' }}
      onPointerDown={(e) => {
        if (pending) return;
        const hit = raycast(ndcOf(e), floorZ(), true);
        if (hit?.kind === 'item') {
          const it = design.items.find((i) => i.uid === hit.uid);
          useStore.getState().select(hit.uid);
          const fl = raycast(ndcOf(e), floorZ(), false);
          if (it && fl?.kind === 'floor') {
            drag.current = { uid: hit.uid, offset: { x: it.pos.x - fl.point.x, y: it.pos.y - fl.point.y } };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }
        } else {
          useStore.getState().select(null);
        }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const hit = raycast(ndcOf(e), floorZ(), false);
        if (hit?.kind !== 'floor') return;
        const it = design.items.find((i) => i.uid === d.uid);
        if (!it) return;
        const pos = { x: hit.point.x + d.offset.x, y: hit.point.y + d.offset.y, z: it.pos.z };
        useStore.getState().moveItem(d.uid, pos, roomIdAt(pos));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onWheel={(e) => {
        const st = useStore.getState();
        if (st.selectedUid && e.shiftKey) st.rotateItem(st.selectedUid, Math.sign(e.deltaY) * (Math.PI / 24));
      }}
    />
  );
}
