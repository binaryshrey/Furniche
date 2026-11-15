'use client';
import { autoFurnish, furnishableType } from './autofurnish';
import { senseRoom } from './scanSense';
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
    const sense = senseRoom(r, { fixtures: !hasDefurnish });
    const res = autoFurnish(r, products, { doors: design.doors, walls: geometry.walls, theme: design.themeId, rooms: geometry.rooms, panos: geometry.panos, sense });
    if (!res) continue;
    st.replaceItems(res.placed.map((p) => ({ productId: p.productId, roomId: p.roomId, pos: p.pos, rot: p.rot })), r.id);
    rooms.push(r.id);
    pieces += res.placed.length;
    spent += res.spent;
    dropped.push(...res.dropped.map((d) => d.product.name.split(',')[0]));
  }
  if (!rooms.length) return null;
  st.replaceItems([], null); // pieces stranded outside every room
  st.setLocked(false);
  return {
    rooms,
    dropped,
    summary: `Furnished ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'} with ${pieces} pieces for ${usd(spent)}, keeping doorways and walking routes clear. Click any piece to move it, rotate it with ↻, or swap it.`,
  };
}
