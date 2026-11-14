'use client';
import { useState } from 'react';
import type { Product } from '@/lib/types';

// The product's own photo when we have one (IKEA's in-room lifestyle shots, or the image an imported page
// gave us); otherwise a material-swatch tile: its top-down footprint at scale, in its colour.
export default function ProductSwatch({ product, size = 72 }: { product: Product; size?: number }) {
  const [broken, setBroken] = useState(false);
  const photo =
    product.imageUrl ??
    (product.retailer === 'ikea' ? `/api/product-image?v=room&id=${encodeURIComponent(product.id)}&name=${encodeURIComponent(product.name)}` : null);

  if (photo && !broken) {
    return (
      <div className="relative shrink-0 overflow-hidden rounded-lg bg-panel" style={{ width: size, height: size }} aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      </div>
    );
  }

  const { w, d } = product.dimsCm;
  const max = Math.max(w, d, 60);
  const pw = Math.max(10, (w / max) * (size - 16));
  const pd = Math.max(product.category === 'rug' ? 10 : 8, (d / max) * (size - 16));
  const round = ['round-table', 'plant', 'planter', 'floor-lamp', 'umbrella'].includes(product.category);
  return (
    <div
      className="relative flex shrink-0 items-center justify-center rounded-lg bg-panel"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <div
        className="shadow-swatch"
        style={{
          width: round ? Math.min(pw, pd) : pw,
          height: round ? Math.min(pw, pd) : pd,
          background: product.color,
          borderRadius: round ? '50%' : product.category === 'rug' ? 2 : 6,
          border: '1px solid rgba(255,255,255,.08)',
        }}
      />
    </div>
  );
}
