'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { RETAILER_LABEL } from '@/catalog/products';
import { checkFit, levelFor } from '@/lib/fit';
import { useViewerState } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { FitLevel, ModelGeometry, PlacedItem, Product } from '@/lib/types';
import { fmtUsd } from '../shop/ShopPanel';
import ProductSwatch from '../shop/ProductSwatch';
import StylistBox from './StylistBox';
import SurfacesBox from './SurfacesBox';

const DOT: Record<FitLevel, string> = { ok: 'bg-ok', warn: 'bg-warn', error: 'bg-bad' };

// embedded: shown inside the Ask Furniche panel, without the sidebar frame, stylist or finishes.
// onPick: a row was chosen (the Ask Furniche panel brings that piece into view).
export default function DesignPanel({ geometry, embedded = false, onPick }: { geometry: ModelGeometry | null; embedded?: boolean; onPick?: (uid: string) => void }) {
  const design = useDesign();
  const productOf = useStore((s) => s.product);
  const selected = useStore((s) => s.selectedUid);
  const { select, removeItem, duplicateItem } = useStore.getState();
  const currentRoomId = useViewerState((s) => s.currentRoomId);

  const resolved = design.items
    .map((item) => ({ item, product: productOf(item.productId) }))
    .filter((x): x is { item: PlacedItem; product: Product } => !!x.product);
  const issues = useMemo(() => checkFit(resolved, geometry?.rooms ?? [], design.doors, geometry?.walls), [resolved, geometry, design.doors]);
  const total = resolved.reduce((s, r) => s + r.product.priceUsd, 0);
  const roomName = (id: string | null) => geometry?.rooms.find((r) => r.id === id)?.label ?? 'Unassigned';
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;

  const byRoom = new Map<string, typeof resolved>();
  for (const r of resolved) byRoom.set(r.item.roomId ?? '', [...(byRoom.get(r.item.roomId ?? '') ?? []), r]);

  return (
    <aside className={embedded ? 'flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-card/50' : 'flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-paper'}>
      <div className="border-b border-line p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg">Your design</h2>
          <span className="num text-sm font-medium">{fmtUsd(total)}</span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {resolved.length} items ·{' '}
          {errors + warns === 0 ? (
            <span className="text-ok">everything fits</span>
          ) : (
            <>
              {errors > 0 && <span className="text-bad">{errors} problems</span>}
              {errors > 0 && warns > 0 && ', '}
              {warns > 0 && <span className="text-warn">{warns} warnings</span>}
            </>
          )}
        </p>
      </div>

      <div className={embedded ? 'space-y-4 p-4' : 'scroll-thin flex-1 space-y-4 overflow-y-auto p-4'}>
        {resolved.length > 0 && (
          <section className="flex items-center gap-3 rounded-2xl border border-line bg-card p-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${design.locked ? 'bg-brand/15 text-brand' : 'bg-panel text-muted'}`} aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <path d={design.locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{design.locked ? 'Furniture locked' : 'Furniture unlocked'}</div>
              <div className="text-[11px] leading-snug text-muted">
                {design.locked ? 'Walk and look around freely. Unlock to move pieces.' : 'Drag pieces to move them, drag ↻ to rotate.'}
              </div>
            </div>
            <button
              role="switch"
              aria-checked={!!design.locked}
              aria-label="Lock furniture"
              onClick={() => useStore.getState().setLocked(!design.locked)}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${design.locked ? 'bg-brand' : 'bg-line'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${design.locked ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </section>
        )}

        {!embedded && <StylistBox geometry={geometry} roomId={currentRoomId} />}

        {resolved.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">
            {embedded ? 'Nothing placed yet. Use Furnish or Furniture to add pieces.' : 'Press Auto-furnish to fill every room, then click any piece to swap it for one that fits.'}
          </div>
        )}

        {[...byRoom.entries()].map(([roomId, rows]) => (
          <section key={roomId}>
            <h3 className="eyebrow mb-2">{roomName(roomId || null)}</h3>
            <ul className="space-y-2">
              {rows.map(({ item, product }) => {
                const level = levelFor(item.uid, issues);
                const mine = issues.filter((i) => i.uid === item.uid);
                const isSel = selected === item.uid;
                return (
                  <li key={item.uid}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => (select(isSel ? null : item.uid), !isSel && onPick?.(item.uid))}
                      onKeyDown={(e) => e.key === 'Enter' && (select(isSel ? null : item.uid), !isSel && onPick?.(item.uid))}
                      className={`cursor-pointer rounded-xl border bg-card/60 p-2.5 ${isSel ? 'border-brand' : 'border-white/10 hover:border-ink/40'}`}
                    >
                      <div className="flex gap-3">
                        <ProductSwatch product={product} size={44} />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[level]}`} aria-label={level} />
                            <span className="truncate font-medium">{product.name.split(',')[0]}</span>
                          </div>
                          <div className="flex justify-between text-xs text-muted">
                            <span>{product.source === 'photo' ? 'From your photo' : RETAILER_LABEL[product.retailer]}</span>
                            <span className="num">{fmtUsd(product.priceUsd)}</span>
                          </div>
                        </div>
                      </div>
                      {mine.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {mine.map((i, k) => (
                            <li key={k} className={`text-xs ${i.level === 'error' ? 'text-bad' : 'text-warn'}`}>
                              {i.message}
                            </li>
                          ))}
                        </ul>
                      )}
                      {isSel && (
                        <div className="mt-2 flex gap-1.5 text-xs">
                          <button onClick={(e) => (e.stopPropagation(), duplicateItem(item.uid))} className="rounded border border-line px-2 py-1">
                            Duplicate
                          </button>
                          <button onClick={(e) => (e.stopPropagation(), removeItem(item.uid))} className="ml-auto rounded border border-bad/40 px-2 py-1 text-bad">
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {!embedded && <SurfacesBox geometry={geometry} roomId={currentRoomId} />}
      </div>

      {/* Embedded in Ask Furniche, which has its own Review cart button. */}
      {!embedded && (
        <div className="border-t border-line p-4">
          <Link href="/cart" className="block w-full rounded-lg btn-brand px-4 py-2.5 text-center text-sm font-medium ">
            Review cart · {fmtUsd(total)}
          </Link>
          <p className="mt-2 text-center text-[11px] text-muted">Click to select, drag the selected piece to move · drag ↻ to rotate · D duplicate · Delete remove</p>
        </div>
      )}
    </aside>
  );
}
