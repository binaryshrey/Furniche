import type { Category, Placement, Product, Retailer, ThemeId } from '@/lib/types';

// IKEA catalogue (see ikea-catalog.json). searchUrl is the fallback link for items without a
// product page, and for imported products from other stores.
export const CATALOG_CHECKED_AT = '2026-11-14';
export const CATALOG_IS_SAMPLE = true;

function searchUrl(retailer: Retailer, name: string): string {
  const q = encodeURIComponent(name);
  switch (retailer) {
    case 'ikea':
      return `https://www.ikea.com/us/en/search/?q=${q}`;
    case 'amazon':
      return `https://www.amazon.com/s?k=${q}`;
    case 'wayfair':
      return `https://www.wayfair.com/keyword.php?keyword=${q}`;
    case 'west-elm':
      return `https://www.westelm.com/search/results.html?words=${q}`;
    case 'target':
      return `https://www.target.com/s?searchTerm=${q}`;
    default:
      return `https://www.google.com/search?q=${q}`;
  }
}

import ikea from './ikea-catalog.json';

// The catalogue is IKEA only: built by scripts/build_ikea_catalog.py from IKEA's own product
// search, so each item carries its real product page (for the true-size 3D model), photo, name
// and price. Footprints come from IKEA's size text where it is unambiguous, else curated values.
type IkeaRow = {
  id: string;
  name: string;
  price: number;
  category: Category;
  dims: [number, number, number];
  color: string;
  styles: ThemeId[];
  placement: Placement;
  url: string | null;
  image: string | null;
  cutout?: string | null;
};

export const PRODUCTS: Product[] = (ikea.products as unknown as IkeaRow[]).map((r) => ({
  id: r.id,
  source: 'curated',
  retailer: 'ikea',
  name: r.name,
  url: r.url ?? searchUrl('ikea', r.name.split(',')[0]),
  imageUrl: r.image ?? undefined,
  cutoutUrl: r.cutout ?? undefined,
  priceUsd: r.price,
  priceCheckedAt: ikea.checkedAt ?? CATALOG_CHECKED_AT,
  category: r.category,
  dimsCm: { w: r.dims[0], d: r.dims[1], h: r.dims[2] },
  color: r.color,
  styles: r.styles,
  placement: r.placement,
  standIn: true,
}));

export const RETAILER_LABEL: Record<Retailer, string> = {
  ikea: 'IKEA',
  amazon: 'Amazon',
  wayfair: 'Wayfair',
  'west-elm': 'West Elm',
  target: 'Target',
  other: 'Other',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  sofa: 'Sofas',
  sectional: 'Sectionals',
  armchair: 'Armchairs',
  'coffee-table': 'Coffee tables',
  'side-table': 'Side tables',
  'tv-console': 'TV consoles',
  bookshelf: 'Shelves',
  'dining-table': 'Dining tables',
  'round-table': 'Round tables',
  'dining-chair': 'Dining chairs',
  bed: 'Beds',
  nightstand: 'Nightstands',
  dresser: 'Dressers',
  wardrobe: 'Wardrobes',
  desk: 'Desks',
  'office-chair': 'Office chairs',
  'floor-lamp': 'Floor lamps',
  rug: 'Rugs',
  plant: 'Plants',
  mirror: 'Mirrors',
  'wall-art': 'Wall art',
  bench: 'Benches',
  'bar-stool': 'Bar stools',
  mattress: 'Mattresses',
  decor: 'Showpieces',
  'patio-table': 'Patio tables',
  'patio-chair': 'Patio chairs',
  lounger: 'Loungers',
  umbrella: 'Umbrellas',
  planter: 'Planters',
};
