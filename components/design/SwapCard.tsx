'use client';
import { useMemo } from 'react';
import { alternatives } from '@/lib/alternatives';
import { useDesign, useProducts, useStore } from '@/lib/store';
import type { ModelGeometry } from '@/lib/types';
import ProductSwatch from '../shop/ProductSwatch';
import { fmtUsd } from '../shop/ShopPanel';

// Click a piece and choose another one for the same spot: a few products that do the same job,
// already checked to fit where it stands, from cheaper to premium.
export default function SwapCard({ geometry }: { geometry: ModelGeometry | null }) {
  const selected = useStore((s) => s.selectedUid);
  const design = useDesign();
  const products = useProducts();
  const item = design.items.find((i) => i.uid === selected) ?? null;
  const current = item ? products.find((p) => p.id === item.productId) ?? null : null;

  const options = useMemo(
    () =>
      item && geometry
        ? alternatives({ item, items: design.items, products, rooms: geometry.rooms, doors: design.doors, walls: geometry.walls, theme: design.themeId })
        : [],
    [item, geometry, design.items, design.doors, design.themeId, products],
  );

  if (!item || !current) return null;
  const close = () => useStore.getState().select(null);

  return (
    <div className="absolute inset-x-3 bottom-3 z-20 rounded-2xl border border-line bg-paper/95 p-3 shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur sm:left-auto sm:right-3 sm:w-[min(640px,calc(100%-24px))]">
      <div className="mb-2 flex items-center gap-3">
        <ProductSwatch product={current} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase tracking-wide text-muted">Swap</div>
          <div className="truncate text-sm font-semibold">
            {current.name.split(',')[0]} <span className="font-normal text-muted">· {fmtUsd(current.priceUsd)}</span>
          </div>
        </div>
        <button
          onClick={() => useStore.getState().removeItem(item.uid)}
          className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40"
        >
          Remove
        </button>
        <button onClick={close} aria-label="Close" className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-card hover:text-ink">
          ×
        </button>
      </div>

      {options.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options.map((o) => (
            <button
              key={o.product.id}
              onClick={() => useStore.getState().swapItem(item.uid, o.item)}
              className="group flex flex-col rounded-xl border border-line bg-card p-2 text-left transition hover:border-brand"
            >
              <div className="relative">
                <ProductSwatch product={o.product} size={128} />
                <span
                  className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    o.tag === 'Tight fit' ? 'bg-warn/90 text-paper' : 'bg-paper/85 text-ink'
                  }`}
                >
                  {o.tag}
                </span>
              </div>
              <div className="mt-2 line-clamp-2 text-xs font-semibold leading-snug">{o.product.name}</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-1 text-[11px]">
                <span className="font-semibold">{fmtUsd(o.product.priceUsd)}</span>
                <span className="truncate text-muted">{o.product.retailer === 'west-elm' ? 'West Elm' : o.product.retailer[0].toUpperCase() + o.product.retailer.slice(1)}</span>
              </div>
              <div className="text-[10px] text-muted">
                {o.product.dimsCm.w} × {o.product.dimsCm.d} cm
              </div>
              <span className="mt-2 rounded-lg bg-ink py-1 text-center text-[11px] font-semibold text-paper opacity-0 transition group-hover:opacity-100">
                Replace
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-2 text-xs text-muted">No other pieces of this kind fit in this spot.</p>
      )}
    </div>
  );
}
