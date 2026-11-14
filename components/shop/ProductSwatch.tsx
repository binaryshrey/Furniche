import type { Product } from '@/lib/types';

// A material-swatch style tile: the product's top-down footprint at scale, in its colour.
export default function ProductSwatch({ product, size = 72 }: { product: Product; size?: number }) {
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
