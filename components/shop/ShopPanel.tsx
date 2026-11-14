'use client';
import { useMemo, useState } from 'react';
import { CATALOG_IS_SAMPLE, CATEGORY_LABEL, RETAILER_LABEL } from '@/catalog/products';
import { THEMES } from '@/catalog/themes';
import { productFitsRoom } from '@/lib/fit';
import { useViewerState } from '@/lib/sceneBridge';
import { useProducts, useStore } from '@/lib/store';
import type { Category, ModelGeometry, Product, Retailer, ThemeId } from '@/lib/types';
import ImportLink from './ImportLink';
import ProductSwatch from './ProductSwatch';

const GROUPS: { label: string; cats: Category[] }[] = [
  { label: 'Seating', cats: ['sofa', 'sectional', 'armchair', 'bench'] },
  { label: 'Tables', cats: ['coffee-table', 'side-table', 'dining-table', 'round-table', 'desk'] },
  { label: 'Chairs', cats: ['dining-chair', 'office-chair', 'bar-stool'] },
  { label: 'Bedroom', cats: ['bed', 'nightstand', 'dresser', 'wardrobe'] },
  { label: 'Storage', cats: ['bookshelf', 'tv-console'] },
  { label: 'Decor', cats: ['rug', 'floor-lamp', 'plant', 'mirror', 'wall-art'] },
];

export const fmtUsd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
export const fmtDims = (p: Product) => `${p.dimsCm.w} × ${p.dimsCm.d} × ${p.dimsCm.h} cm`;

export default function ShopPanel({ geometry }: { geometry: ModelGeometry | null }) {
  const products = useProducts();
  const pending = useStore((s) => s.pendingProductId);
  const setPending = useStore((s) => s.setPending);
  const currentRoomId = useViewerState((s) => s.currentRoomId);
  const room = geometry?.rooms.find((r) => r.id === currentRoomId) ?? null;

  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('All');
  const [retailer, setRetailer] = useState<Retailer | 'all'>('all');
  const [theme, setTheme] = useState<ThemeId | 'all'>('all');
  const [fitsOnly, setFitsOnly] = useState(false);
  const [maxPrice, setMaxPrice] = useState(3000);

  const list = useMemo(() => {
    const cats = GROUPS.find((g) => g.label === group)?.cats;
    return products.filter(
      (p) =>
        p.placement !== 'outdoor' &&
        (!cats || cats.includes(p.category)) &&
        (retailer === 'all' || p.retailer === retailer) &&
        (theme === 'all' || p.styles.includes(theme)) &&
        p.priceUsd <= maxPrice &&
        (!fitsOnly || productFitsRoom(p, room)) &&
        (!q || `${p.name} ${CATEGORY_LABEL[p.category]} ${RETAILER_LABEL[p.retailer]}`.toLowerCase().includes(q.toLowerCase())),
    );
  }, [products, group, retailer, theme, maxPrice, fitsOnly, room, q]);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-line bg-paper">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg">Shop</h2>
          <span className="text-xs text-muted">{list.length} items</span>
        </div>
        <input
          id="shop-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sofas, KALLAX, oak…"
          className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap gap-1.5">
          {['All', ...GROUPS.map((g) => g.label)].map((g) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className={`rounded-full border px-2.5 py-1 text-xs ${group === g ? 'border-ink bg-ink text-paper' : 'border-line bg-card'}`}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <select id="shop-retailer" value={retailer} onChange={(e) => setRetailer(e.target.value as Retailer | 'all')} className="rounded-md border border-line bg-card px-2 py-1.5">
            <option value="all">All stores</option>
            {(Object.keys(RETAILER_LABEL) as Retailer[]).filter((r) => r !== 'other').map((r) => (
              <option key={r} value={r}>
                {RETAILER_LABEL[r]}
              </option>
            ))}
          </select>
          <select id="shop-theme" value={theme} onChange={(e) => setTheme(e.target.value as ThemeId | 'all')} className="rounded-md border border-line bg-card px-2 py-1.5">
            <option value="all">All styles</option>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="w-20 text-muted">Up to {fmtUsd(maxPrice)}</span>
          <input id="shop-price" type="range" min={50} max={3000} step={50} value={maxPrice} onChange={(e) => setMaxPrice(+e.target.value)} className="flex-1 accent-ink" />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input id="shop-fits" type="checkbox" checked={fitsOnly} onChange={(e) => setFitsOnly(e.target.checked)} className="accent-sage" />
          Fits this room {room ? <span className="text-muted">({room.label}, {room.widthM.toFixed(1)} × {room.depthM.toFixed(1)} m)</span> : <span className="text-muted">(walk into a room)</span>}
        </label>
      </div>

      <ul className="scroll-thin flex-1 space-y-2 overflow-y-auto p-3">
        {list.map((p) => (
          <li key={p.id}>
            <div
              role="button"
              tabIndex={0}
              aria-pressed={pending === p.id}
              onPointerDown={(e) => {
                e.preventDefault();
                setPending(p.id);
              }}
              onKeyDown={(e) => e.key === 'Enter' && setPending(p.id)}
              className={`flex cursor-grab select-none gap-3 rounded-xl border bg-card p-2.5 transition hover:border-ink/40 ${
                pending === p.id ? 'border-ink ring-1 ring-ink' : 'border-line'
              }`}
              title="Drag into the room, or click and then click the floor"
            >
              <ProductSwatch product={p} size={64} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="truncate font-medium">{p.name.split(',')[0]}</div>
                <div className="truncate text-xs text-muted">{p.name.split(',').slice(1).join(',').trim() || CATEGORY_LABEL[p.category]}</div>
                <div className="mt-1 flex items-center justify-between text-xs">
                  <span className="num font-medium">{fmtUsd(p.priceUsd)}</span>
                  <span className="text-muted">{RETAILER_LABEL[p.retailer]}</span>
                </div>
                <div className="num text-[11px] text-muted">{fmtDims(p)}</div>
              </div>
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="p-6 text-center text-sm text-muted">Nothing matches. Clear a filter or raise the price limit.</li>}
      </ul>

      <div className="border-t border-line p-3">
        <ImportLink />
        {CATALOG_IS_SAMPLE && <p className="mt-2 text-[11px] leading-snug text-muted">Sample catalog. Confirm price and size at the store before buying.</p>}
      </div>
    </aside>
  );
}
