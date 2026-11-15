'use client';
import Link from 'next/link';
import { compressToEncodedURIComponent } from 'lz-string';
import { useMemo, useState } from 'react';
import { RETAILER_LABEL } from '@/catalog/products';
import { THEMES } from '@/catalog/themes';
import { surfaceLines } from '@/components/design/SurfacesBox';
import ProductSwatch from '@/components/shop/ProductSwatch';
import { fmtUsd } from '@/components/shop/ShopPanel';
import type { MoveInBudget } from '@/lib/budget';
import { floorStats } from '@/lib/designOps';
import { checkFit } from '@/lib/fit';
import { useDesign, useProducts, useStore } from '@/lib/store';
import type { FitIssue, ModelGeometry, PlacedItem, Product, Retailer } from '@/lib/types';

const RETAILER_COLOR: Record<Retailer, string> = { ikea: '#f2c94c', amazon: '#f2994a', wayfair: '#9b51e0', 'west-elm': '#6fcf97', target: '#eb5757', other: '#a3a3a3' };

// The design as a designer would present it: the look, the money, then each room as a board with
// its finishes and pieces. Every piece can be brought into view, duplicated, swapped or removed.
export default function MyDesignTab({
  geometry,
  budget,
  onFocus,
  onAutoFurnish,
  onBrowse,
}: {
  geometry: ModelGeometry | null;
  budget: MoveInBudget | null;
  onFocus: (uid: string) => void;
  onAutoFurnish: () => void;
  onBrowse: () => void;
}) {
  const design = useDesign();
  const products = useProducts();
  const selected = useStore((s) => s.selectedUid);
  const [copied, setCopied] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const resolved = design.items.map((item) => ({ item, product: byId.get(item.productId) })).filter((x): x is { item: PlacedItem; product: Product } => !!x.product);
  const issues: FitIssue[] = useMemo(() => checkFit(resolved, geometry?.rooms ?? [], design.doors, geometry?.walls), [resolved, geometry, design.doors]);
  const finishes = surfaceLines(geometry, design.surfaces, design.doors);
  const furniture = resolved.reduce((s, r) => s + r.product.priceUsd, 0);
  const finishTotal = finishes.reduce((s, f) => s + f.cost, 0);
  const total = furniture + finishTotal;
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  const theme = THEMES.find((t) => t.id === design.themeId) ?? null;

  const rooms = (geometry?.rooms ?? []).filter((r) => resolved.some((x) => x.item.roomId === r.id) || design.surfaces.some((s) => s.roomId === r.id));
  const byStore = new Map<Retailer, number>();
  for (const r of resolved) byStore.set(r.product.retailer, (byStore.get(r.product.retailer) ?? 0) + r.product.priceUsd);
  const stores = [...byStore.entries()].sort((a, b) => b[1] - a[1]);

  function share() {
    const url = `${location.origin}${location.pathname}#d${compressToEncodedURIComponent(JSON.stringify(useStore.getState().design()))}`;
    navigator.clipboard?.writeText(url).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1800)),
      () => window.prompt('Copy this link', url),
    );
  }

  if (!resolved.length && !design.surfaces.length) {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-card/30 px-6 py-10 text-center">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden>
          <path d="M4 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 12h18v4H3zM5 16v2M19 16v2" />
        </svg>
        <h3 className="mt-3 font-display text-lg font-semibold">Your design board is empty</h3>
        <p className="mt-1 max-w-[260px] text-xs text-muted">Furnish every room in one go, or pick pieces yourself. Everything you place shows up here, room by room.</p>
        <div className="mt-4 flex gap-2">
          <button onClick={onAutoFurnish} className="rounded-full btn-brand px-4 py-2 text-xs font-semibold">
            Auto-furnish every room
          </button>
          <button onClick={onBrowse} className="rounded-full border border-white/20 px-4 py-2 text-xs font-semibold hover:bg-white/5">
            Browse furniture
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The look and the money */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-card/50">
        {theme && (
          <div className="flex h-2" aria-hidden>
            {theme.palette.map((c) => (
              <span key={c} className="flex-1" style={{ background: c }} />
            ))}
          </div>
        )}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="eyebrow">{theme ? `${theme.name} look` : 'Your design'}</div>
              <div className="num mt-1 font-display text-3xl font-semibold">{fmtUsd(total)}</div>
              <div className="mt-0.5 text-[11px] text-muted">
                {fmtUsd(furniture)} furniture{finishTotal ? ` · ${fmtUsd(finishTotal)} paint and flooring` : ''}
              </div>
            </div>
            {budget && (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${total <= budget.safeToSpend ? 'bg-ok/15 text-ok' : total <= budget.safeToSpend + budget.cardRoom ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad'}`}>
                {total <= budget.safeToSpend ? `${fmtUsd(budget.safeToSpend - total)} under budget` : `${fmtUsd(total - budget.safeToSpend)} over budget`}
              </span>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              [String(resolved.length), resolved.length === 1 ? 'piece' : 'pieces'],
              [String(rooms.length), rooms.length === 1 ? 'room' : 'rooms'],
              [errors + warns === 0 ? '✓' : String(errors + warns), errors + warns === 0 ? 'all fit' : errors ? 'fit problems' : 'warnings'],
            ].map(([v, l]) => (
              <div key={l} className="rounded-xl bg-paper/40 py-2">
                <dt className="sr-only">{l}</dt>
                <dd className={`num font-display text-lg font-semibold ${l === 'all fit' ? 'text-ok' : l === 'fit problems' ? 'text-bad' : l === 'warnings' ? 'text-warn' : ''}`}>{v}</dd>
                <dd className="text-[10px] uppercase tracking-wide text-muted">{l}</dd>
              </div>
            ))}
          </dl>

          {stores.length > 0 && (
            <div className="mt-4">
              <div className="flex h-2 overflow-hidden rounded-full" aria-hidden>
                {stores.map(([r, v]) => (
                  <span key={r} style={{ width: `${(v / furniture) * 100}%`, background: RETAILER_COLOR[r] }} />
                ))}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                {stores.map(([r, v]) => (
                  <li key={r} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: RETAILER_COLOR[r] }} aria-hidden />
                    {RETAILER_LABEL[r]} <span className="num text-ink">{fmtUsd(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={share} className="rounded-xl border border-white/20 py-2 text-xs font-semibold hover:bg-white/5">
              {copied ? 'Link copied' : 'Share design'}
            </button>
            <Link href="/cart" className="rounded-xl btn-brand py-2 text-center text-xs font-semibold">
              Review cart
            </Link>
          </div>
        </div>
      </section>

      {/* One board per room */}
      {rooms.map((room) => {
        const pieces = resolved.filter((x) => x.item.roomId === room.id);
        const roomFinishes = finishes.filter((f) => f.room.id === room.id);
        const sub = pieces.reduce((s, x) => s + x.product.priceUsd, 0) + roomFinishes.reduce((s, f) => s + f.cost, 0);
        const open = floorStats(room, design.items, products).freeShare;
        return (
          <section key={room.id} className="rounded-2xl border border-white/10 bg-card/50 p-3">
            <header className="flex items-baseline justify-between gap-2 px-1">
              <h3 className="font-display text-base font-semibold">{room.label}</h3>
              <span className="num text-sm font-semibold">{fmtUsd(sub)}</span>
            </header>
            <p className="px-1 text-[11px] text-muted">
              {room.widthM.toFixed(1)} × {room.depthM.toFixed(1)} m · {Math.round(open * 100)}% floor open
            </p>

            {roomFinishes.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5 px-1">
                {roomFinishes.map((f) => (
                  <li key={f.s.uid} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-paper/40 py-0.5 pl-0.5 pr-2 text-[11px]">
                    <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: f.m.color }} aria-hidden />
                    {typeof f.s.target === 'string' ? (f.s.target === 'floor' ? 'Floor' : 'Walls') : 'Wall'}: {f.m.name}
                  </li>
                ))}
              </ul>
            )}

            {pieces.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {pieces.map(({ item, product }) => {
                  const mine = issues.filter((i) => i.uid === item.uid);
                  const bad = mine.some((i) => i.level === 'error');
                  const isSel = selected === item.uid;
                  return (
                    <li key={item.uid}>
                      <div className={`group relative overflow-hidden rounded-xl border bg-paper/40 transition ${isSel ? 'border-brand ring-1 ring-brand' : 'border-white/10 hover:border-white/30'}`}>
                        <button
                          onClick={() => (useStore.getState().select(item.uid), onFocus(item.uid))}
                          className="block w-full text-left"
                          title="Show in the room"
                        >
                          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-panel/60 [&>div]:!h-full [&>div]:!w-full [&>div]:rounded-none">
                            <ProductSwatch product={product} size={180} />
                          </div>
                          <div className="p-2">
                            <div className="line-clamp-1 text-xs font-semibold">{product.name.split(',')[0]}</div>
                            <div className="mt-0.5 flex items-baseline justify-between text-[11px] text-muted">
                              <span>{RETAILER_LABEL[product.retailer]}</span>
                              <span className="num text-ink">{fmtUsd(product.priceUsd)}</span>
                            </div>
                          </div>
                        </button>
                        {mine.length > 0 && (
                          <span className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${bad ? 'bg-bad text-white' : 'bg-warn text-paper'}`} title={mine.map((i) => i.message).join('\n')}>
                            {bad ? 'Doesn’t fit' : 'Tight'}
                          </span>
                        )}
                        <div className={`absolute right-1.5 top-1.5 flex gap-1 transition ${isSel ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}>
                          <button
                            onClick={() => useStore.getState().duplicateItem(item.uid)}
                            className="grid h-7 w-7 place-items-center rounded-full bg-paper/80 text-xs hover:bg-paper"
                            aria-label={`Duplicate ${product.name}`}
                            title="Duplicate"
                          >
                            ⧉
                          </button>
                          <button
                            onClick={() => useStore.getState().removeItem(item.uid)}
                            className="grid h-7 w-7 place-items-center rounded-full bg-paper/80 text-xs text-bad hover:bg-paper"
                            aria-label={`Remove ${product.name}`}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}

      <p className="px-1 text-center text-[11px] text-muted">Tap a piece to see it in the room and swap it. Drag it in the tour to move; drag ↻ to rotate.</p>
    </div>
  );
}
