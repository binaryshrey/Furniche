'use client';
import { autoFurnish, furnishableType } from './autofurnish';
import { linkDoors } from './closets';
import { closetNextTo, openingsFor, stageRoom } from './stage';
import { useViewerState } from './sceneBridge';
import { senseBuiltins, senseClosets, senseRoom } from './scanSense';
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
    // Doors the mesh hides (an open door leaf) come from the tour's own sightlines between rooms.
    const doors = [...design.doors, ...linkDoors(r, geometry.rooms, geometry.panos, useViewerState.getState().sweepLinks ?? [])];
    const kind = furnishableType(r);
    const walls = geometry.walls[r.floorId] ?? [];
    // Bedrooms and living rooms get a full staged set, kept off the floor plan's real windows
    // and doorways; other rooms use the general layout.
    if ((kind === 'bedroom' || kind === 'living') && walls.some((w) => w.openings?.length)) {
      const open = openingsFor(r, walls);
      // Plus doorways seen only from the tour's sightlines, laid along the nearest wall.
      for (const d of doors.filter((x) => x.roomId === r.id)) {
        if (open.doors.some((o) => Math.hypot((o.a.x + o.b.x) / 2 - d.pos.x, (o.a.y + o.b.y) / 2 - d.pos.y) < 0.6)) continue;
        open.doors.push(alongWall(r, d.pos, d.widthM));
      }
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
    const res = autoFurnish(r, products, { doors, walls: geometry.walls, theme: design.themeId, rooms: geometry.rooms, panos: geometry.panos, sense });
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

// A doorway known only by its middle point and width, as a span along the nearest wall.
function alongWall(room: { polygon: { x: number; y: number }[] }, p: { x: number; y: number }, width: number) {
  let best = { a: p, b: p, d: Infinity };
  room.polygon.forEach((a, i) => {
    const b = room.polygon[(i + 1) % room.polygon.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const u = Math.max(0, Math.min(len, (p.x - a.x) * t.x + (p.y - a.y) * t.y));
    const q = { x: a.x + t.x * u, y: a.y + t.y * u };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.d) best = { a: { x: q.x - (t.x * width) / 2, y: q.y - (t.y * width) / 2 }, b: { x: q.x + (t.x * width) / 2, y: q.y + (t.y * width) / 2 }, d };
  });
  return { a: best.a, b: best.b };
}
