import type { Product } from './types';

// Where a piece that hangs on a wall sits, and what picture it shows.

// Height of the piece's bottom edge above the floor, in metres. Art and small mirrors hang with
// their middle near eye level (about 1.45 m) but clear of a sofa or headboard (bottom edge between
// 0.95 and 1.2 m). A full-length mirror (1.5 m or taller) leans on the wall just off the floor.
export function hangLift(p: Pick<Product, 'dimsCm' | 'placement'>): number {
  if (p.placement !== 'wall') return 0;
  const h = p.dimsCm.h / 100;
  if (h >= 1.5) return 0.04;
  return Math.min(1.2, Math.max(0.95, 1.45 - h / 2));
}

// The piece's own picture for its 3D face, served from our origin (IKEA's image CDN sends no CORS
// headers, so the browser could not use it as a texture directly).
export function pictureUrl(p: Pick<Product, 'cutoutUrl' | 'placement'>): string | undefined {
  return p.placement === 'wall' && p.cutoutUrl ? `/api/product-image?src=${encodeURIComponent(p.cutoutUrl)}` : undefined;
}
