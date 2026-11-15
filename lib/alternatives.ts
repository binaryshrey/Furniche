import { checkFit } from './fit';
import type { Category, DoorMark, PlacedItem, Product, Room, ThemeId, Wall } from './types';

// Swap suggestions for a placed piece: other products that do the same job, tried in the same
// spot and kept only if they still fit. A handful, spread across price.

const FAMILIES: Category[][] = [
  ['sofa', 'sectional'],
  ['armchair'],
  ['coffee-table'],
  ['side-table', 'nightstand'],
  ['dining-table', 'round-table'],
  ['dining-chair'],
  ['tv-console'],
  ['bookshelf'],
  ['bed'],
  ['dresser', 'wardrobe'],
  ['desk'],
  ['office-chair'],
  ['rug'],
  ['plant', 'planter'],
];
// Pieces that stand with their back to a wall keep the back where it was when the depth changes.
const WALL_BACKED = new Set<Category>(['sofa', 'sectional', 'bed', 'dresser', 'wardrobe', 'tv-console', 'bookshelf', 'desk', 'nightstand']);

export type Alternative = { product: Product; item: PlacedItem; tag: 'Best match' | 'Cheaper' | 'Premium' | 'Also fits' | 'Tight fit'; fits: boolean };

const realModel = (p: Product) => p.retailer === 'ikea' && /^https:\/\/www\.ikea\.com\//.test(p.url);

// The replacement as placed: same spot and facing, with a wall-backed piece's back kept in place.
export function swapped(item: PlacedItem, from: Product, to: Product): PlacedItem {
  if (!WALL_BACKED.has(to.category)) return { ...item, productId: to.id };
  const shift = (to.dimsCm.d - from.dimsCm.d) / 200; // half the change in depth, metres
  const front = { x: Math.sin(item.rot), y: -Math.cos(item.rot) }; // the piece's facing direction
  return { ...item, productId: to.id, pos: { ...item.pos, x: item.pos.x + front.x * shift, y: item.pos.y + front.y * shift } };
}

export function alternatives(opts: {
  item: PlacedItem;
  items: PlacedItem[];
  products: Product[];
  rooms: Room[];
  doors?: DoorMark[];
  walls?: Record<string, Wall[]>;
  theme?: ThemeId | null;
  count?: number;
}): Alternative[] {
  const { item, items, products, rooms, doors = [], walls, theme = null, count = 4 } = opts;
  const byId = new Map(products.map((p) => [p.id, p]));
  const current = byId.get(item.productId);
  if (!current) return [];
  const family = FAMILIES.find((f) => f.includes(current.category)) ?? [current.category];
  const room = rooms.find((r) => r.id === item.roomId);

  const tried = products
    // Pieces made from the shopper's photos can't be bought, so they are never offered as swaps.
    .filter((p) => p.id !== current.id && p.source !== 'photo' && family.includes(p.category) && p.placement === current.placement)
    .filter((p) => !room?.heightM || p.dimsCm.h / 100 < room.heightM)
    .map((p) => {
      const placed = swapped(item, current, p);
      const scene = items.map((i) => (i.uid === item.uid ? placed : i)).map((i) => ({ item: i, product: byId.get(i.productId)! })).filter((x) => x.product);
      const issues = checkFit(scene, rooms, doors, walls).filter((x) => x.uid === item.uid);
      const fits = !issues.some((x) => x.level === 'error');
      let score = 0;
      if (realModel(p)) score += 3; // real textured 3D model
      if (theme && p.styles.includes(theme)) score += 2;
      if (current.styles.some((s) => p.styles.includes(s))) score += 1;
      score -= (Math.abs(p.dimsCm.w - current.dimsCm.w) + Math.abs(p.dimsCm.d - current.dimsCm.d)) / 100;
      score -= issues.length * 0.5;
      return { product: p, item: placed, fits, score };
    });

  // Pieces that fit first; fall back to near-misses only if too few fit.
  const pool = [...tried.filter((t) => t.fits), ...tried.filter((t) => !t.fits)].slice(0, Math.max(count * 3, 8));
  const ranked = [...pool].sort((a, b) => Number(b.fits) - Number(a.fits) || b.score - a.score);
  const picked: Alternative[] = [];
  const take = (t: (typeof pool)[number] | undefined, tag: Alternative['tag']) => {
    if (!t || picked.some((x) => x.product.id === t.product.id) || picked.length >= count) return;
    picked.push({ product: t.product, item: t.item, tag, fits: t.fits });
  };
  const fitting = ranked.filter((t) => t.fits);
  take(ranked[0], ranked[0]?.fits ? 'Best match' : 'Tight fit');
  const unpicked = (t: (typeof pool)[number]) => !picked.some((x) => x.product.id === t.product.id);
  take(fitting.filter((t) => unpicked(t) && t.product.priceUsd < current.priceUsd)[0], 'Cheaper');
  take(fitting.filter((t) => unpicked(t) && t.product.priceUsd > current.priceUsd)[0], 'Premium');
  for (const t of ranked) take(t, t.fits ? 'Also fits' : 'Tight fit');
  return picked;
}
