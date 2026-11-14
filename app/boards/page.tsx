'use client';
import { useState } from 'react';
import { MATERIALS, materialById } from '@/catalog/materials';
import { PRODUCTS } from '@/catalog/products';
import { THEMES } from '@/catalog/themes';
import ProductSwatch from '@/components/shop/ProductSwatch';
import { fmtUsd } from '@/components/shop/ShopPanel';
import { TopNav } from '@/components/ui/Brand';
import type { ThemeId } from '@/lib/types';

// MattoBoard-style mood boards: a theme's palette, finishes and real products on one canvas.
export default function Boards() {
  const [id, setId] = useState<ThemeId>('japandi');
  const theme = THEMES.find((t) => t.id === id)!;
  const products = PRODUCTS.filter((p) => p.styles.includes(id) && p.placement !== 'outdoor').slice(0, 9);
  const wall = materialById(theme.wallPaint);
  const floor = materialById(theme.floor);
  const extras = MATERIALS.filter((m) => m.kind === 'wallpaper').slice(0, 1);

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="eyebrow">Mood boards</p>
        <h1 className="font-display text-4xl">Start from a look</h1>
        <div className="mt-6 flex flex-wrap gap-2">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => setId(t.id)} className={`rounded-full border px-4 py-1.5 text-sm ${id === t.id ? 'border-ink bg-ink text-paper' : 'border-line bg-card'}`}>
              {t.name}
            </button>
          ))}
        </div>

        <section className="relative mt-8 min-h-[560px] overflow-hidden rounded-3xl border border-line bg-card p-8">
          <div className="absolute inset-0 opacity-[0.35]" style={{ background: `radial-gradient(circle at 20% 20%, ${theme.palette[1]}, transparent 55%)` }} />
          <div className="relative grid gap-8 md:grid-cols-[260px_1fr]">
            <div>
              <h2 className="font-display text-3xl">{theme.name}</h2>
              <p className="mt-2 text-sm text-muted">{theme.blurb}</p>
              <div className="mt-6 grid grid-cols-5 overflow-hidden rounded-xl shadow-swatch">
                {theme.palette.map((c) => (
                  <div key={c} style={{ background: c }} className="h-20" title={c} />
                ))}
              </div>
              <div className="mt-6 space-y-3">
                {[wall, floor, ...extras].filter(Boolean).map((m) => (
                  <div key={m!.id} className="flex items-center gap-3">
                    <div
                      className="h-14 w-14 rounded-lg shadow-swatch"
                      style={{
                        background:
                          m!.kind === 'wallpaper'
                            ? `repeating-linear-gradient(90deg, ${m!.color} 0 8px, ${(m as any).accent} 8px 10px)`
                            : m!.kind === 'floor'
                              ? `repeating-linear-gradient(0deg, ${m!.color} 0 10px, rgba(0,0,0,.12) 10px 11px)`
                              : m!.color,
                      }}
                    />
                    <div className="text-sm">
                      <div className="font-medium">{m!.name}</div>
                      <div className="text-xs text-muted">{m!.brand}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative grid grid-cols-2 gap-5 sm:grid-cols-3">
              {products.map((p, i) => (
                <div key={p.id} className="rounded-2xl bg-paper p-3 shadow-swatch" style={{ transform: `rotate(${[-2, 1.5, -1, 2, -1.5, 1, 0.5, -2, 1][i]}deg)` }}>
                  <div className="flex justify-center">
                    <ProductSwatch product={p} size={120} />
                  </div>
                  <div className="mt-2 truncate text-sm font-medium">{p.name.split(',')[0]}</div>
                  <div className="flex justify-between text-xs text-muted">
                    <span>{p.retailer.toUpperCase()}</span>
                    <span className="num">{fmtUsd(p.priceUsd)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        <p className="mt-4 text-sm text-muted">
          Open a home and type “{theme.name.toLowerCase()} under $3,000” into the stylist to apply this look to a real room.
        </p>
      </main>
    </div>
  );
}
