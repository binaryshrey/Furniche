'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RETAILER_LABEL } from '@/catalog/products';
import ProductSwatch from '@/components/shop/ProductSwatch';
import { fmtUsd } from '@/components/shop/ShopPanel';
import { placeFree } from '@/lib/designOps';
import { roomScenes } from '@/lib/roomScenes';
import { productFitsRoom } from '@/lib/fit';
import { useProducts, useStore } from '@/lib/store';
import type { Category, ModelGeometry, Product, Room } from '@/lib/types';

export const FURNITURE_GROUPS: { id: string; label: string; blurb: string; icon: string; cats: Category[] }[] = [
  { id: 'seating', label: 'Seating', blurb: 'Sofas, sectionals, armchairs and benches, at true size.', icon: 'M4 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 12h18v4H3zM5 16v2M19 16v2', cats: ['sofa', 'sectional', 'armchair', 'bench'] },
  { id: 'tables', label: 'Tables', blurb: 'Coffee, side, dining tables and desks.', icon: 'M3 8h18M5 8v10M19 8v10M8 8v4h8V8', cats: ['coffee-table', 'side-table', 'dining-table', 'round-table', 'desk'] },
  { id: 'chairs', label: 'Chairs', blurb: 'Dining chairs, desk chairs and stools.', icon: 'M7 3v9h10V3M6 12h12v3H6zM7 15v6M17 15v6', cats: ['dining-chair', 'office-chair', 'bar-stool'] },
  { id: 'bedroom', label: 'Bedroom', blurb: 'Beds, mattresses, nightstands, dressers and wardrobes.', icon: 'M3 18V8M3 13h18v5M21 18v-5a3 3 0 0 0-3-3h-7v3', cats: ['bed', 'mattress', 'nightstand', 'dresser', 'wardrobe'] },
  { id: 'storage', label: 'Storage', blurb: 'Shelves and TV consoles.', icon: 'M5 3h14v18H5zM5 9h14M5 15h14', cats: ['bookshelf', 'tv-console'] },
  { id: 'lighting', label: 'Lighting', blurb: 'Floor lamps and uplighters to light every corner.', icon: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z', cats: ['floor-lamp'] },
  { id: 'showpieces', label: 'Showpieces', blurb: 'Vases, baskets, pouffes, plant stands and lanterns.', icon: 'M8 21h8M9 21c-2-3-2-6 0-9h6c2 3 2 6 0 9M10 12V8h4v4M11 8V5h2v3', cats: ['decor', 'plant'] },
  { id: 'walls', label: 'Art & mirrors', blurb: 'Framed art, posters and mirrors. Click a wall to hang them.', icon: 'M4 4h16v16H4zM4 15l5-5 4 4 3-3 4 4', cats: ['wall-art', 'mirror'] },
  { id: 'decor', label: 'Rugs', blurb: 'Flatwoven and low-pile rugs to anchor a room.', icon: 'M3 7h18v10H3zM6 7v10M18 7v10', cats: ['rug'] },
];

// One category as a card: a carousel with the current piece large in the middle, its neighbours
// tucked behind, dots below, and "Add to room" placing it at the best open spot.
export function CategoryCarousel({
  group,
  room,
  geometry,
  onSeeAll,
  onAdded,
}: {
  group: (typeof FURNITURE_GROUPS)[number];
  room: Room | null;
  geometry: ModelGeometry | null;
  onSeeAll: () => void;
  onAdded: (p: Product, placed: boolean) => void;
}) {
  const all = useProducts();
  const themeId = useStore((s) => (s.activeSid ? s.designs[s.activeSid]?.themeId : null) ?? null);
  // Pieces that fit this room first, the design's theme first among those.
  const list = useMemo(() => {
    const rows = all.filter((p) => group.cats.includes(p.category) && p.placement !== 'outdoor');
    const fits = (p: Product) => (room ? productFitsRoom(p, room) : true);
    return rows.sort((a, b) => Number(fits(b)) - Number(fits(a)) || Number(!!themeId && b.styles.includes(themeId)) - Number(!!themeId && a.styles.includes(themeId)) || a.priceUsd - b.priceUsd).slice(0, 10);
  }, [all, group, room, themeId]);
  const [i, setI] = useState(0);
  const [hover, setHover] = useState(false);
  const touch = useRef<number | null>(null);
  const n = list.length;
  const at = (k: number) => list[((k % n) + n) % n];

  // Gentle auto-advance, like the template; pauses while the pointer is over the card.
  useEffect(() => {
    if (hover || n < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), 4500);
    return () => clearInterval(t);
  }, [hover, n]);

  if (!n) return null;
  const cur = at(i);
  const fits = room ? productFitsRoom(cur, room) : null;

  function add(p: Product) {
    const st = useStore.getState();
    // Wall pieces (mirrors, art) are hung by hand: click the wall where they go.
    if (room && geometry && p.placement !== 'wall') {
      const d = st.design();
      const spot = placeFree(p, room, { items: d.items, surfaces: d.surfaces, doors: d.doors, themeId: d.themeId }, { geometry, products: st.products(), scenes: roomScenes(geometry, [room.id]) });
      if (spot) {
        st.addItem(p.id, spot.pos, spot.roomId, spot.rot);
        return onAdded(p, true);
      }
    }
    // No room yet, or no open spot: let them click where it should go.
    st.setPending(p.id);
    onAdded(p, false);
  }

  return (
    <section
      className="rounded-2xl border border-white/10 bg-card/50 p-4"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-roledescription="carousel"
      aria-label={group.label}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-line" aria-hidden>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={group.icon} />
              </svg>
            </span>
            {group.label}
          </h3>
          <p className="mt-1 text-xs text-muted">{group.blurb}</p>
        </div>
        <button onClick={onSeeAll} className="shrink-0 rounded-xl bg-ink px-3 py-1.5 text-xs font-semibold text-paper hover:opacity-90">
          See all
        </button>
      </div>

      <div
        className="relative mt-4 h-[188px] select-none"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (Math.abs(dx) > 30) setI((x) => x + (dx < 0 ? 1 : -1));
          touch.current = null;
        }}
      >
        {n > 1 &&
          [-1, 1].map((side) => {
            const p = at(i + side);
            return (
              <button
                key={side}
                onClick={() => setI((x) => x + side)}
                aria-label={side < 0 ? `Previous: ${p.name}` : `Next: ${p.name}`}
                className={`absolute top-1/2 flex h-[140px] w-[46%] -translate-y-1/2 items-center justify-center rounded-2xl border border-line bg-panel opacity-40 transition hover:opacity-70 ${side < 0 ? 'left-0 -rotate-3' : 'right-0 rotate-3'}`}
              >
                <ProductSwatch product={p} size={70} />
              </button>
            );
          })}
        <div
          key={cur.id}
          className="absolute left-1/2 top-0 z-10 flex h-full w-[74%] -translate-x-1/2 flex-col overflow-hidden rounded-2xl shadow-swatch"
          style={{ background: 'linear-gradient(160deg, #dfe8f0 0%, #c4d3df 100%)' }}
        >
          <div className="flex flex-1 items-center justify-center gap-3 px-3 pt-3">
            <div className="rotate-[-4deg] rounded-xl bg-white p-1 shadow-swatch">
              <ProductSwatch product={cur} size={92} />
            </div>
            <div className="min-w-0 flex-1 text-[#1b1b1b]">
              <div className="line-clamp-2 text-sm font-semibold leading-tight">{cur.name.split(',')[0]}</div>
              <div className="mt-0.5 text-[11px] text-[#4a5560]">{RETAILER_LABEL[cur.retailer]}</div>
              <div className="num mt-1 text-base font-semibold">{fmtUsd(cur.priceUsd)}</div>
              <div className="num text-[10px] text-[#4a5560]">
                {cur.dimsCm.w}×{cur.dimsCm.d}×{cur.dimsCm.h} cm
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 pb-3 pt-2">
            {fits !== null && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${fits ? 'bg-[#1f7a46]/15 text-[#1f7a46]' : 'bg-[#b3261e]/15 text-[#b3261e]'}`}>
                {fits ? `Fits the ${room!.label.toLowerCase()}` : 'Too big for this room'}
              </span>
            )}
            <button onClick={() => add(cur)} className="ml-auto rounded-full bg-[#1b1b1b] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-black">
              Add to room
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-center gap-1.5" role="tablist" aria-label={`${group.label} pieces`}>
        {list.map((p, k) => {
          const on = ((i % n) + n) % n === k;
          return <button key={p.id} role="tab" aria-selected={on} aria-label={p.name} onClick={() => setI(k)} className={`h-2 rounded-full transition-all ${on ? 'w-6 bg-ink' : 'w-2 bg-line hover:bg-muted'}`} />;
        })}
      </div>
    </section>
  );
}

// Every piece in a group as a grid, for "See all".
export function CategoryGrid({ group, room, geometry, onBack, onAdded }: { group: (typeof FURNITURE_GROUPS)[number]; room: Room | null; geometry: ModelGeometry | null; onBack: () => void; onAdded: (p: Product, placed: boolean) => void }) {
  const all = useProducts();
  const [cat, setCat] = useState<Category | 'all'>('all');
  const rows = all.filter((p) => group.cats.includes(p.category) && p.placement !== 'outdoor' && (cat === 'all' || p.category === cat)).sort((a, b) => a.priceUsd - b.priceUsd);
  function add(p: Product) {
    const st = useStore.getState();
    // Wall pieces (mirrors, art) are hung by hand: click the wall where they go.
    if (room && geometry && p.placement !== 'wall') {
      const d = st.design();
      const spot = placeFree(p, room, { items: d.items, surfaces: d.surfaces, doors: d.doors, themeId: d.themeId }, { geometry, products: st.products(), scenes: roomScenes(geometry, [room.id]) });
      if (spot) {
        st.addItem(p.id, spot.pos, spot.roomId, spot.rot);
        return onAdded(p, true);
      }
    }
    st.setPending(p.id);
    onAdded(p, false);
  }
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-muted hover:text-ink">
        ← All categories
      </button>
      <h3 className="font-display text-lg font-semibold">{group.label}</h3>
      <div className="flex flex-wrap gap-1.5">
        {(['all', ...group.cats] as const).map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`rounded-full border px-2.5 py-1 text-[11px] ${cat === c ? 'border-ink bg-ink text-paper' : 'border-line'}`}>
            {c === 'all' ? 'All' : c.replace(/-/g, ' ')}
          </button>
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {rows.map((p) => {
          const fits = room ? productFitsRoom(p, room) : true;
          return (
            <li key={p.id} className="flex flex-col rounded-xl border border-white/10 bg-paper/50 p-2">
              <ProductSwatch product={p} size={140} />
              <div className="mt-1.5 line-clamp-2 text-xs font-medium leading-tight">{p.name.split(',')[0]}</div>
              <div className="mt-0.5 flex items-baseline justify-between text-[11px] text-muted">
                <span>{RETAILER_LABEL[p.retailer]}</span>
                <span className="num text-ink">{fmtUsd(p.priceUsd)}</span>
              </div>
              <button onClick={() => add(p)} disabled={!fits} className="mt-1.5 rounded-full border border-line py-1 text-[11px] hover:border-ink/50 disabled:opacity-40">
                {fits ? 'Add to room' : 'Too big'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
