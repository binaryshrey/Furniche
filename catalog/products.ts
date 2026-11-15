import type { Category, Placement, Product, Retailer, ThemeId } from '@/lib/types';

// Sample catalog. Sizes are the products' published dimensions as remembered at build time;
// prices are approximate. Both must be checked against the live product page before the demo.
// Links go to the retailer's search for the product name rather than guessed product URLs.
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

type Row = [
  id: string,
  retailer: Retailer,
  name: string,
  price: number,
  category: Category,
  w: number,
  d: number,
  h: number,
  color: string,
  styles: ThemeId[],
  placement?: Placement,
];

const ROWS: Row[] = [
  // Sofas and seating
  ['ikea-kivik-3', 'ikea', 'KIVIK 3-seat sofa, Tibbleby beige', 899, 'sofa', 228, 95, 83, '#cfc3ad', ['scandinavian', 'modern-organic', 'coastal']],
  ['ikea-ektorp-3', 'ikea', 'EKTORP 3-seat sofa, Hallarp gray', 699, 'sofa', 218, 88, 88, '#a7a9a6', ['scandinavian', 'coastal']],
  ['ikea-friheten-corner', 'ikea', 'FRIHETEN corner sofa-bed, Skiftebo dark gray', 799, 'sectional', 230, 151, 66, '#5b5d60', ['industrial', 'scandinavian']],
  ['ikea-poang', 'ikea', 'POÄNG armchair, birch veneer / Knisa light beige', 149, 'armchair', 68, 82, 100, '#d8c7a6', ['scandinavian', 'japandi']],
  ['ikea-strandmon', 'ikea', 'STRANDMON wing chair, Nordvalla dark gray', 349, 'armchair', 82, 96, 101, '#55585c', ['coastal', 'scandinavian']],
  ['amazon-rivet-revolve', 'amazon', 'Rivet Revolve modern upholstered sofa, 80"', 829, 'sofa', 203, 86, 81, '#3e4a5a', ['midcentury', 'industrial']],
  ['amazon-zinus-benton', 'amazon', 'Zinus Benton mid-century sofa', 399, 'sofa', 190, 79, 81, '#8a6d55', ['midcentury']],
  ['westelm-harmony', 'west-elm', 'Harmony sofa, 82"', 2299, 'sofa', 208, 101, 76, '#e7e0d2', ['modern-organic', 'japandi', 'coastal']],
  ['westelm-sweep-chair', 'west-elm', 'Sweep chair', 899, 'armchair', 76, 81, 78, '#b98b62', ['midcentury', 'modern-organic']],
  ['wayfair-boucle-accent', 'wayfair', 'Bouclé barrel accent chair', 259, 'armchair', 71, 69, 74, '#efe9de', ['modern-organic', 'japandi']],

  // Tables
  ['ikea-lack-coffee', 'ikea', 'LACK coffee table, black-brown', 39.99, 'coffee-table', 90, 55, 45, '#3a2f2a', ['scandinavian', 'industrial']],
  ['ikea-listerby-coffee', 'ikea', 'LISTERBY coffee table, oak veneer', 199, 'coffee-table', 140, 60, 50, '#b8936a', ['japandi', 'scandinavian', 'modern-organic']],
  ['ikea-lack-side', 'ikea', 'LACK side table, white', 14.99, 'side-table', 55, 55, 45, '#f2f2ef', ['scandinavian']],
  ['westelm-mid-century-coffee', 'west-elm', 'Mid-Century pop-up coffee table', 699, 'coffee-table', 107, 66, 41, '#7b5236', ['midcentury']],
  ['amazon-round-travertine', 'amazon', 'Round faux travertine coffee table, 31"', 189, 'coffee-table', 79, 79, 40, '#d9cbb4', ['modern-organic', 'coastal']],
  ['ikea-ekedalen', 'ikea', 'EKEDALEN extendable table, oak', 349, 'dining-table', 120, 80, 75, '#b8936a', ['scandinavian', 'japandi']],
  ['ikea-docksta', 'ikea', 'DOCKSTA round table, white', 249, 'round-table', 103, 103, 75, '#f4f4f1', ['midcentury', 'scandinavian']],
  ['westelm-mid-century-dining', 'west-elm', 'Mid-Century expandable dining table, 60"', 1299, 'dining-table', 152, 91, 76, '#7b5236', ['midcentury']],
  ['ikea-lisabo-chair', 'ikea', 'LISABO chair, ash veneer', 89, 'dining-chair', 46, 52, 80, '#cfb38b', ['japandi', 'scandinavian']],
  ['ikea-odger-chair', 'ikea', 'ODGER chair, anthracite', 75, 'dining-chair', 45, 51, 81, '#3d4042', ['industrial', 'scandinavian']],
  ['amazon-eames-style-chair', 'amazon', 'Mid-century molded dining chair (set of 1)', 59, 'dining-chair', 46, 53, 82, '#efece6', ['midcentury', 'coastal']],

  // Storage and media
  ['ikea-kallax-2x4', 'ikea', 'KALLAX shelf unit 2x4, white', 109, 'bookshelf', 77, 39, 147, '#f4f4f1', ['scandinavian']],
  ['ikea-billy', 'ikea', 'BILLY bookcase, white', 69, 'bookshelf', 80, 28, 202, '#f4f4f1', ['scandinavian', 'coastal']],
  ['ikea-hemnes-tv', 'ikea', 'HEMNES TV unit, white stain', 279, 'tv-console', 183, 47, 57, '#ece8df', ['coastal', 'scandinavian']],
  ['ikea-besta-tv', 'ikea', 'BESTÅ TV bench, black-brown', 160, 'tv-console', 180, 42, 38, '#3a2f2a', ['industrial', 'midcentury']],
  ['westelm-mid-century-media', 'west-elm', 'Mid-Century media console, 60"', 1199, 'tv-console', 152, 46, 64, '#7b5236', ['midcentury']],
  ['amazon-industrial-shelf', 'amazon', '5-tier industrial ladder bookshelf', 89, 'bookshelf', 80, 34, 180, '#5a4636', ['industrial']],

  // Bedroom
  ['ikea-malm-queen', 'ikea', 'MALM bed frame, high, queen, white stained oak veneer', 399, 'bed', 165, 214, 100, '#e3d7c3', ['scandinavian', 'japandi']],
  ['ikea-hemnes-bed-queen', 'ikea', 'HEMNES bed frame, queen, white stain', 499, 'bed', 174, 211, 112, '#ece8df', ['coastal', 'scandinavian']],
  ['ikea-taellasen-full', 'ikea', 'TÄLLÅSEN upholstered bed frame with mattress, Kulsta gray-green/Valevåg medium firm, full', 798, 'bed', 149, 203, 107, '#8c9d96', ['scandinavian', 'modern-organic']],
  ['amazon-zinus-platform-queen', 'amazon', 'Zinus wood platform bed, queen', 289, 'bed', 158, 208, 89, '#9a7656', ['japandi', 'modern-organic', 'midcentury']],
  ['ikea-hemnes-nightstand', 'ikea', 'HEMNES nightstand, white stain', 99, 'nightstand', 46, 35, 70, '#ece8df', ['coastal', 'scandinavian']],
  ['ikea-tarva-nightstand', 'ikea', 'TARVA nightstand, pine', 59, 'nightstand', 48, 39, 61, '#d9b98f', ['japandi', 'scandinavian']],
  ['ikea-malm-6', 'ikea', 'MALM 6-drawer dresser, white', 299, 'dresser', 160, 48, 78, '#f4f4f1', ['scandinavian']],
  ['ikea-pax-100', 'ikea', 'PAX wardrobe frame 100x58x201, white', 220, 'wardrobe', 100, 58, 201, '#f4f4f1', ['scandinavian']],

  // Office
  ['ikea-lisabo-desk', 'ikea', 'LISABO desk, ash veneer', 149, 'desk', 118, 45, 74, '#cfb38b', ['japandi', 'scandinavian']],
  ['ikea-micke-desk', 'ikea', 'MICKE desk, white', 79, 'desk', 105, 50, 75, '#f4f4f1', ['scandinavian']],
  ['ikea-markus', 'ikea', 'MARKUS office chair, Vissle dark gray', 229, 'office-chair', 62, 60, 140, '#3d4042', ['industrial', 'scandinavian']],
  ['amazon-standing-desk', 'amazon', 'Electric standing desk, 55" x 28"', 249, 'desk', 140, 71, 74, '#6d5a49', ['industrial', 'modern-organic']],

  // Decor and lighting
  ['ikea-hektar-floor', 'ikea', 'HEKTAR floor lamp, dark gray', 59, 'floor-lamp', 40, 40, 181, '#3d4042', ['industrial']],
  ['amazon-arc-lamp', 'amazon', 'Brightech arc floor lamp, brass', 129, 'floor-lamp', 40, 100, 190, '#b89a5a', ['midcentury', 'modern-organic']],
  ['ikea-stockholm-rug', 'ikea', 'STOCKHOLM rug, flatwoven, 8\'2" x 11\'6"', 299, 'rug', 250, 350, 1, '#d8d2c6', ['scandinavian', 'japandi']],
  ['ikea-lohals-rug', 'ikea', 'LOHALS rug, flatwoven, natural, 5\'3" x 7\'7"', 79, 'rug', 160, 230, 1, '#cdb48d', ['coastal', 'japandi', 'modern-organic']],
  ['wayfair-moroccan-rug', 'wayfair', 'Moroccan trellis area rug, 8\' x 10\'', 189, 'rug', 244, 305, 1, '#e8e2d6', ['coastal', 'midcentury']],
  ['amazon-fiddle-leaf', 'amazon', 'Artificial fiddle leaf fig tree, 6 ft', 79, 'plant', 50, 50, 183, '#4c6b45', ['modern-organic', 'coastal', 'japandi']],
  ['ikea-hovet-mirror', 'ikea', 'HOVET mirror, aluminum', 199, 'mirror', 78, 4, 196, '#c9cbc8', ['industrial', 'scandinavian'], 'wall'],
  ['target-arched-mirror', 'target', 'Arched wood frame floor mirror', 179, 'mirror', 66, 4, 167, '#b8936a', ['modern-organic', 'japandi'], 'wall'],
  ['amazon-abstract-canvas', 'amazon', 'Abstract neutral canvas wall art, 24" x 36"', 69, 'wall-art', 61, 3, 91, '#d2b48c', ['modern-organic', 'japandi'], 'wall'],
  ['ikea-norraker-bench', 'ikea', 'NORRÅKER bench, birch', 79, 'bench', 74, 29, 45, '#d9c09a', ['scandinavian', 'japandi']],
  ['amazon-bar-stool', 'amazon', 'Industrial metal bar stool, 26"', 55, 'bar-stool', 41, 41, 66, '#3d4042', ['industrial']],

  // Outdoor
  ['ikea-applaro-table', 'ikea', 'ÄPPLARÖ table, outdoor, brown stained', 249, 'patio-table', 140, 78, 72, '#7a5a3c', ['coastal', 'modern-organic'], 'outdoor'],
  ['ikea-applaro-chair', 'ikea', 'ÄPPLARÖ chair, outdoor, brown stained', 79, 'patio-chair', 55, 58, 86, '#7a5a3c', ['coastal', 'modern-organic'], 'outdoor'],
  ['amazon-chaise-lounger', 'amazon', 'Outdoor wicker chaise lounge', 199, 'lounger', 66, 193, 33, '#8a7356', ['coastal'], 'outdoor'],
  ['amazon-patio-umbrella', 'amazon', 'Patio umbrella, 9 ft', 69, 'umbrella', 274, 274, 245, '#e9e1cf', ['coastal'], 'outdoor'],
  ['target-planter', 'target', 'Large ceramic outdoor planter', 59, 'planter', 46, 46, 50, '#cdbfa8', ['modern-organic', 'coastal'], 'outdoor'],
];

// Exact product pages (read from IKEA's site), for items where the search link would be vaguer.
const PAGE_URL: Record<string, string> = {
  'ikea-taellasen-full': 'https://www.ikea.com/us/en/p/taellasen-upholstered-bed-frame-with-mattress-kulsta-gray-green-valevag-medium-firm-s19537138/',
};

export const PRODUCTS: Product[] = ROWS.map(([id, retailer, name, price, category, w, d, h, color, styles, placement]) => ({
  id,
  source: 'curated',
  retailer,
  name,
  url: PAGE_URL[id] ?? searchUrl(retailer, name.split(',')[0]),
  priceUsd: price,
  priceCheckedAt: CATALOG_CHECKED_AT,
  category,
  dimsCm: { w, d, h },
  color,
  styles,
  placement: placement ?? 'floor',
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
  'patio-table': 'Patio tables',
  'patio-chair': 'Patio chairs',
  lounger: 'Loungers',
  umbrella: 'Umbrellas',
  planter: 'Planters',
};
