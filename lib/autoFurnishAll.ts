'use client';
import { autoFurnish, furnishableType } from './autofurnish';
import { senseBuiltins, senseClosets, senseRoom } from './scanSense';
import { closetNextTo, openingsFor, stageRoom } from './stage';
import { useViewerState } from './sceneBridge';
import { useStore } from './store';
import type { ModelGeometry } from './types';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Furnish every furnishable room at once: recommended pieces for each room's type and size,
// laid out by trying several layouts and keeping the best. Replaces only those rooms' pieces and
// leaves the furniture unlocked, so every piece can be dragged afterwards.
export function autoFurnishAll(geometry: ModelGeometry): { rooms: string[]; summary: string; dropped: string[] } | null {
  const st = useStore.getState();
  const design = st.design();
  const products = st.products();
  // A defurnished model's mesh still holds the seller's furniture, so its "fixtures" aren't fixed.
  const hasDefurnish = useViewerState.getState().hasDefurnish;
  const rooms: string[] = [];
  const dropped: string[] = [];
  let pieces = 0;
  let spent = 0;
  for (const r of geometry.rooms.filter((x) => furnishableType(x))) {
    let sense = null;
    try {
      sense = senseRoom(r, { fixtures: !hasDefurnish });
    } catch {
      /* scan not loaded here yet */
    }
    const kind = furnishableType(r);
    const walls = geometry.walls[r.floorId] ?? [];
    // Bedrooms and living rooms get a full staged set, kept off the floor plan's real windows
    // and doorways; other rooms use the general layout.
    if ((kind === 'bedroom' || kind === 'living') && walls.some((w) => w.openings?.length)) {
      const open = openingsFor(r, walls);
      if (!open.windows.length && sense) open.windows.push(...sense.windows);
      try {
        open.builtins = senseBuiltins(r, { tallOnly: hasDefurnish });
      } catch {
        /* scan not loaded here yet */
      }
      // A reach-in closet (not one of the plan's doorways or windows) counts as the room's closet,
      // and its doors need the same clear space as a doorway.
      let closets: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
      try {
        const mid = (s: { a: { x: number; y: number }; b: { x: number; y: number } }) => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
        const known = [...open.doors, ...open.windows].map(mid);
        closets = senseClosets(r).filter((c) => !known.some((k) => Math.hypot(k.x - mid(c).x, k.y - mid(c).y) < 0.6));
      } catch {
        /* scan not loaded here yet */
      }
      open.doors.push(...closets);
      const res = stageRoom(r, kind, products, open, sense?.fixtures ?? [], undefined, { hasCloset: closets.length > 0 || closetNextTo(r, geometry.rooms) });
      if (!res.placed.length) continue;
      st.replaceItems(res.placed.map((p) => ({ productId: p.productId, roomId: p.roomId, pos: p.pos, rot: p.rot })), r.id);
      rooms.push(r.id);
      pieces += res.placed.length;
      spent += res.placed.reduce((s, p) => s + (products.find((x) => x.id === p.productId)?.priceUsd ?? 0), 0);
      dropped.push(...res.missing.map((m) => `${m} (${r.label.toLowerCase()})`));
      continue;
    }
    const res = autoFurnish(r, products, { doors: design.doors, walls: geometry.walls, theme: design.themeId, rooms: geometry.rooms, panos: geometry.panos, sense });
    if (!res) continue;
    st.replaceItems(res.placed.map((p) => ({ productId: p.productId, roomId: p.roomId, pos: p.pos, rot: p.rot })), r.id);
    rooms.push(r.id);
    pieces += res.placed.length;
    spent += res.spent;
    dropped.push(...res.dropped.map((d) => d.product.name.split(',')[0]));
  }
  // Kitchens keep only their own counters.
  for (const r of geometry.rooms) if (/kitchen/i.test(r.label)) st.clearRoom(r.id);
  if (!rooms.length) return null;
  st.replaceItems([], null); // pieces stranded outside every room
  st.setLocked(false);
  return {
    rooms,
    dropped,
    summary: `Furnished ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} with ${pieces} pieces for ${usd(spent)}, kept off the windows and doorways, nothing overlapping. Click any piece to move it, rotate it with ↻, or swap it.`,
  };
}
