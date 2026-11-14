'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PRODUCTS, RETAILER_LABEL } from '@/catalog/products';
import ProductSwatch from '@/components/shop/ProductSwatch';
import { fmtDims, fmtUsd } from '@/components/shop/ShopPanel';
import { checkOutdoor, footprint, levelFor } from '@/lib/fit';
import { polygonArea } from '@/lib/geometry';
import { useDesign, useStore } from '@/lib/store';
import type { FitLevel, PlacedItem, Product, Vec2 } from '@/lib/types';

const FILL: Record<FitLevel, string> = { ok: '#6cc08a', warn: '#e6ae45', error: '#ea6a58' };
const OUTDOOR = PRODUCTS.filter((p) => p.placement === 'outdoor');

export type PropertyData = {
  listingId: string;
  address: string;
  sizeM: number;
  parcel: Vec2[];
  buildings: Vec2[][];
  pool: boolean;
  hardscapeM2: number | null;
  deckM2: number | null;
  treeCoverPct: number | null;
  imageDate: string | null;
};

// Top-down yard planner on the Vexcel aerial image. Local frame: metres, x east, y north,
// origin at the image centre, so SVG y is flipped like the indoor plan.
export default function OutdoorPlanner({ property, sid }: { property: PropertyData; sid: string | null }) {
  const design = useDesign();
  const productOf = useStore((s) => s.product);
  const pending = useStore((s) => s.pendingProductId);
  const selected = useStore((s) => s.selectedUid);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ uid: string; off: Vec2 } | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);
  // Visible window in local metres; the wheel zooms toward the cursor so small pieces are easy to grab.
  const [view, setView] = useState({ cx: 0, cy: 0, size: property.sizeM });
  const st = () => useStore.getState();

  useEffect(() => {
    st().setActive(`out:${property.listingId}`);
  }, [property.listingId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const uid = st().selectedUid;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') st().setPending(null);
      if (!uid) return;
      if (e.key === 'r' || e.key === 'R') st().rotateItem(uid, (e.shiftKey ? -1 : 1) * (Math.PI / 12));
      if (e.key === 'd' || e.key === 'D') st().duplicateItem(uid);
      if (e.key === 'Delete' || e.key === 'Backspace') st().removeItem(uid);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const resolved = design.items
    .map((item) => ({ item, product: productOf(item.productId) }))
    .filter((x): x is { item: PlacedItem; product: Product } => !!x.product);
  const issues = useMemo(() => checkOutdoor(resolved, property.parcel, property.buildings), [resolved, property]);
  const total = resolved.reduce((s, r) => s + r.product.priceUsd, 0);
  const lotM2 = polygonArea(property.parcel);
  const builtM2 = property.buildings.reduce((s, b) => s + polygonArea(b), 0);

  const half = property.sizeM / 2;
  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: -p.y };
  };
  const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${-p.y}`).join(' ');
  const sqft = (m2: number) => `${Math.round(m2 * 10.764).toLocaleString()} sq ft`;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-paper">
        <div className="border-b border-line p-4">
          <h2 className="font-display text-lg">Outdoor shop</h2>
          <p className="text-xs text-muted">Click a piece, then click the yard.</p>
        </div>
        <ul className="scroll-thin flex-1 space-y-2 overflow-y-auto p-3">
          {OUTDOOR.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => st().setPending(pending === p.id ? null : p.id)}
                className={`flex w-full gap-3 rounded-xl border bg-card p-2.5 text-left ${pending === p.id ? 'border-ink ring-1 ring-ink' : 'border-line'}`}
              >
                <ProductSwatch product={p} size={52} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{p.name.split(',')[0]}</div>
                  <div className="mt-0.5 flex justify-between text-xs">
                    <span className="num">{fmtUsd(p.priceUsd)}</span>
                    <span className="text-muted">{RETAILER_LABEL[p.retailer]}</span>
                  </div>
                  <div className="num text-[11px] text-muted">{fmtDims(p)}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="relative flex-1 bg-paper">
        <svg
          ref={svgRef}
          className="h-full w-full touch-none select-none"
          viewBox={`${view.cx - view.size / 2} ${-view.cy - view.size / 2} ${view.size} ${view.size}`}
          onWheel={(e) => {
            const w = toWorld(e);
            const size = Math.min(property.sizeM, Math.max(6, view.size * Math.exp(e.deltaY * 0.0015)));
            const k = size / view.size;
            const clamp = (v: number) => Math.max(-half + size / 2, Math.min(half - size / 2, v));
            setView({ size, cx: clamp(w.x + (view.cx - w.x) * k), cy: clamp(w.y + (view.cy - w.y) * k) });
          }}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={(e) => {
            const w = toWorld(e);
            setHover(w);
            const d = drag.current;
            if (d) {
              const it = design.items.find((i) => i.uid === d.uid);
              if (it) st().moveItem(d.uid, { x: w.x + d.off.x, y: w.y + d.off.y, z: 0 }, 'parcel');
            }
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={(e) => {
            drag.current = null;
            if (pending) {
              const w = toWorld(e);
              st().addItem(pending, { x: w.x, y: w.y, z: 0 }, 'parcel', 0);
              st().setPending(null);
            }
          }}
          onPointerDown={() => !pending && st().select(null)}
        >
          <image href={`/api/vexcel/ortho?listing=${property.listingId}`} x={-half} y={-half} width={property.sizeM} height={property.sizeM} />
          <polygon points={pts(property.parcel)} fill="rgba(255,255,255,.08)" stroke="#fff" strokeWidth={0.18} strokeDasharray="0.6 0.35" />
          {property.buildings.map((b, i) => (
            <polygon key={i} points={pts(b)} fill="rgba(31,28,25,.28)" stroke="#1f1c19" strokeWidth={0.1} />
          ))}
          {resolved.map(({ item, product }) => {
            const level = levelFor(item.uid, issues);
            const isSel = item.uid === selected;
            return (
              <polygon
                key={item.uid}
                points={pts(footprint(item, product))}
                fill={product.color}
                fillOpacity={product.category === 'umbrella' ? 0.55 : 0.95}
                stroke={level === 'ok' ? (isSel ? '#fff' : '#1f1c19') : FILL[level]}
                strokeWidth={isSel || level !== 'ok' ? 0.14 : 0.06}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  st().select(item.uid);
                  const w = toWorld(e);
                  drag.current = { uid: item.uid, off: { x: item.pos.x - w.x, y: item.pos.y - w.y } };
                }}
              />
            );
          })}
          {pending && hover && (() => {
            const p = productOf(pending);
            if (!p) return null;
            return (
              <polygon
                points={pts(footprint({ uid: 'g', productId: p.id, roomId: null, pos: { ...hover, z: 0 }, rot: 0 }, p))}
                fill={p.color}
                opacity={0.6}
                stroke="#fff"
                strokeDasharray="0.3 0.2"
                strokeWidth={0.08}
              />
            );
          })()}
          {/* 5 m scale bar */}
          <g transform={`translate(${view.cx - view.size / 2 + view.size * 0.03} ${-view.cy - view.size / 2 + view.size * 0.05}) scale(${view.size / property.sizeM})`} style={{ pointerEvents: 'none' }}>
            <rect x={0} y={-0.25} width={5} height={0.5} fill="#fff" stroke="#000" strokeWidth={0.08} />
            <text x={2.5} y={-0.8} fontSize={1} textAnchor="middle" fill="#fff" style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 0.15 }}>
              5 m
            </text>
          </g>
        </svg>
        <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-card/90 px-2 py-1 text-[11px] text-muted">
          {pending ? 'Click inside the lot to place.' : 'Scroll to zoom · drag to move · R rotate · D duplicate · Delete remove.'} Aerial imagery © Vexcel
          {property.imageDate ? `, ${property.imageDate.slice(0, 7)}` : ''}.
        </div>
      </main>

      <aside className="flex w-[320px] shrink-0 flex-col border-l border-line bg-paper">
        <div className="border-b border-line p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-lg">The yard</h2>
            <span className="num text-sm">{fmtUsd(total)}</span>
          </div>
          <p className="truncate text-xs text-muted">{property.address}</p>
          {sid && (
            <Link href={`/space/${sid}`} className="mt-2 inline-block text-xs underline">
              Back inside
            </Link>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-line p-4 text-sm">
          <dt className="text-muted">Lot</dt>
          <dd className="num text-right">{sqft(lotM2)}</dd>
          <dt className="text-muted">Buildings</dt>
          <dd className="num text-right">{sqft(builtM2)}</dd>
          <dt className="text-muted">Open ground</dt>
          <dd className="num text-right">{sqft(Math.max(0, lotM2 - builtM2))}</dd>
          <dt className="text-muted">Paved</dt>
          <dd className="num text-right">{property.hardscapeM2 != null ? sqft(property.hardscapeM2) : '—'}</dd>
          <dt className="text-muted">Deck</dt>
          <dd className="num text-right">{property.deckM2 != null ? sqft(property.deckM2) : 'None seen'}</dd>
          <dt className="text-muted">Pool</dt>
          <dd className="text-right">{property.pool ? 'Yes' : 'No'}</dd>
          <dt className="text-muted">Tree cover</dt>
          <dd className="num text-right">{property.treeCoverPct != null ? `${Math.round(property.treeCoverPct)}%` : '—'}</dd>
        </dl>
        <ul className="scroll-thin flex-1 space-y-2 overflow-y-auto p-3">
          {resolved.map(({ item, product }) => {
            const mine = issues.filter((i) => i.uid === item.uid);
            const level = levelFor(item.uid, issues);
            return (
              <li
                key={item.uid}
                onClick={() => st().select(item.uid)}
                className={`cursor-pointer rounded-xl border bg-card p-2.5 text-sm ${item.uid === selected ? 'border-ink' : 'border-line'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: FILL[level] }} />
                    <span className="truncate font-medium">{product.name.split(',')[0]}</span>
                  </span>
                  <span className="num shrink-0">{fmtUsd(product.priceUsd)}</span>
                </div>
                {mine.map((i) => (
                  <div key={i.message} className="mt-1 text-xs" style={{ color: FILL[i.level] }}>
                    {i.message}
                  </div>
                ))}
              </li>
            );
          })}
          {resolved.length === 0 && <li className="p-4 text-center text-sm text-muted">Pick a patio set on the left and drop it in the yard.</li>}
        </ul>
        <div className="border-t border-line p-3">
          <Link href="/cart" className="block rounded-lg btn-brand py-2.5 text-center text-sm font-medium ">
            Review cart · {fmtUsd(total)}
          </Link>
        </div>
      </aside>
    </div>
  );
}
