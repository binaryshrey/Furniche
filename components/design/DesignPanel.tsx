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

export default function DesignPanel({ geometry }: { geometry: ModelGeometry | null }) {
  const design = useDesign();
  const productOf = useStore((s) => s.product);
  const selected = useStore((s) => s.selectedUid);
  const { select, rotateItem, removeItem, duplicateItem } = useStore.getState();
  const currentRoomId = useViewerState((s) => s.currentRoomId);

  const resolved = design.items
    .map((item) => ({ item, product: productOf(item.productId) }))
    .filter((x): x is { item: PlacedItem; product: Product } => !!x.product);
  const issues = useMemo(() => checkFit(resolved, geometry?.rooms ?? [], design.doors), [resolved, geometry, design.doors]);
  const total = resolved.reduce((s, r) => s + r.product.priceUsd, 0);
  const roomName = (id: string | null) => geometry?.rooms.find((r) => r.id === id)?.label ?? 'Unassigned';
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;

  const byRoom = new Map<string, typeof resolved>();
  for (const r of resolved) byRoom.set(r.item.roomId ?? '', [...(byRoom.get(r.item.roomId ?? '') ?? []), r]);

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col border-l border-line bg-paper">
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

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
        <StylistBox geometry={geometry} roomId={currentRoomId} />

        {resolved.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">
            Drag a piece from the shop into the room, or ask the stylist to furnish it for you.
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
                      onClick={() => select(isSel ? null : item.uid)}
                      onKeyDown={(e) => e.key === 'Enter' && select(isSel ? null : item.uid)}
                      className={`rounded-xl border bg-card p-2.5 ${isSel ? 'border-ink' : 'border-line'}`}
                    >
                      <div className="flex gap-3">
                        <ProductSwatch product={product} size={44} />
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[level]}`} aria-label={level} />
                            <span className="truncate font-medium">{product.name.split(',')[0]}</span>
                          </div>
                          <div className="flex justify-between text-xs text-muted">
                            <span>{RETAILER_LABEL[product.retailer]}</span>
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
                          <button onClick={(e) => (e.stopPropagation(), rotateItem(item.uid, Math.PI / 12))} className="rounded border border-line px-2 py-1">
                            Rotate 15°
                          </button>
                          <button onClick={(e) => (e.stopPropagation(), rotateItem(item.uid, Math.PI / 2))} className="rounded border border-line px-2 py-1">
                            90°
                          </button>
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

        <SurfacesBox geometry={geometry} roomId={currentRoomId} />
      </div>

      <div className="border-t border-line p-4">
        <Link href="/cart" className="block w-full rounded-lg btn-brand px-4 py-2.5 text-center text-sm font-medium ">
          Review cart · {fmtUsd(total)}
        </Link>
        <p className="mt-2 text-center text-[11px] text-muted">Keys: R rotate · D duplicate · Delete remove · Esc cancel</p>
      </div>
    </aside>
  );
}
