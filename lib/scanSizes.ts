import type { Category } from './types';

// What a scanned piece is likely to be, and its usual real size, so a model made from a photo comes
// out true to size on its own (lib/recognize.ts picks the entry from the cut-out). Width × depth ×
// height in cm, for a typical one; `by` is the measurement that varies least for its kind
// (height, but width for flat things), and the model's own shape gives the other two.
export type ScanKind = { name: string; category: Category; w: number; d: number; h: number; by?: 'w' | 'h' };

export const SCAN_KINDS: ScanKind[] = [
  // Seating
  { name: 'sofa', category: 'sofa', w: 200, d: 90, h: 85 },
  { name: 'sectional sofa', category: 'sectional', w: 280, d: 180, h: 85 },
  { name: 'loveseat', category: 'sofa', w: 150, d: 85, h: 85 },
  { name: 'armchair', category: 'armchair', w: 80, d: 85, h: 95 },
  { name: 'lounge chair', category: 'armchair', w: 75, d: 80, h: 78 },
  { name: 'recliner chair', category: 'armchair', w: 90, d: 95, h: 100 },
  { name: 'rocking chair', category: 'armchair', w: 65, d: 90, h: 100 },
  { name: 'bean bag chair', category: 'armchair', w: 90, d: 90, h: 80 },
  { name: 'dining chair', category: 'dining-chair', w: 45, d: 52, h: 90 },
  { name: 'folding chair', category: 'dining-chair', w: 45, d: 50, h: 80 },
  { name: 'office chair', category: 'office-chair', w: 65, d: 65, h: 110 },
  { name: 'stool', category: 'bar-stool', w: 40, d: 40, h: 50 },
  { name: 'bar stool', category: 'bar-stool', w: 40, d: 40, h: 75 },
  { name: 'bench', category: 'bench', w: 120, d: 40, h: 45 },
  { name: 'ottoman', category: 'decor', w: 60, d: 60, h: 42 },
  { name: 'pouf', category: 'decor', w: 50, d: 50, h: 40 },
  // Tables and storage
  { name: 'coffee table', category: 'coffee-table', w: 110, d: 60, h: 45 },
  { name: 'side table', category: 'side-table', w: 50, d: 50, h: 55 },
  { name: 'console table', category: 'side-table', w: 110, d: 35, h: 80 },
  { name: 'dining table', category: 'dining-table', w: 160, d: 90, h: 75 },
  { name: 'round table', category: 'round-table', w: 100, d: 100, h: 75 },
  { name: 'desk', category: 'desk', w: 120, d: 60, h: 75 },
  { name: 'bookshelf', category: 'bookshelf', w: 80, d: 30, h: 180 },
  { name: 'shoe rack', category: 'bookshelf', w: 80, d: 30, h: 50 },
  { name: 'dresser', category: 'dresser', w: 120, d: 50, h: 80 },
  { name: 'chest of drawers', category: 'dresser', w: 80, d: 45, h: 100 },
  { name: 'cabinet', category: 'dresser', w: 80, d: 40, h: 90 },
  { name: 'nightstand', category: 'nightstand', w: 50, d: 40, h: 55 },
  { name: 'wardrobe', category: 'wardrobe', w: 100, d: 60, h: 200 },
  { name: 'tv stand', category: 'tv-console', w: 150, d: 40, h: 50 },
  // Beds
  { name: 'bed', category: 'bed', w: 160, d: 210, h: 100 },
  { name: 'crib', category: 'bed', w: 75, d: 130, h: 95 },
  { name: 'mattress', category: 'mattress', w: 150, d: 200, h: 25, by: 'w' },
  { name: 'dog bed', category: 'decor', w: 80, d: 60, h: 20, by: 'w' },
  // Lighting
  { name: 'floor lamp', category: 'floor-lamp', w: 40, d: 40, h: 160 },
  { name: 'table lamp', category: 'decor', w: 30, d: 30, h: 55 },
  { name: 'desk lamp', category: 'decor', w: 18, d: 18, h: 45 },
  { name: 'lantern', category: 'decor', w: 20, d: 20, h: 40 },
  { name: 'candle', category: 'decor', w: 8, d: 8, h: 12 },
  // Walls and floors
  { name: 'rug', category: 'rug', w: 200, d: 300, h: 1, by: 'w' },
  { name: 'mirror', category: 'mirror', w: 60, d: 3, h: 90 },
  { name: 'framed picture', category: 'wall-art', w: 50, d: 3, h: 70 },
  { name: 'painting', category: 'wall-art', w: 60, d: 3, h: 80 },
  { name: 'wall clock', category: 'wall-art', w: 30, d: 5, h: 30 },
  // Plants
  { name: 'potted plant', category: 'plant', w: 40, d: 40, h: 90 },
  { name: 'small houseplant', category: 'plant', w: 20, d: 20, h: 30 },
  { name: 'indoor tree', category: 'plant', w: 60, d: 60, h: 170 },
  { name: 'cactus', category: 'plant', w: 15, d: 15, h: 30 },
  { name: 'planter', category: 'planter', w: 40, d: 40, h: 40 },
  // Decor
  { name: 'vase', category: 'decor', w: 15, d: 15, h: 30 },
  { name: 'basket', category: 'decor', w: 40, d: 40, h: 35 },
  { name: 'sculpture', category: 'decor', w: 30, d: 30, h: 50 },
  { name: 'globe', category: 'decor', w: 30, d: 30, h: 40 },
  { name: 'table clock', category: 'decor', w: 25, d: 10, h: 25 },
  { name: 'picture frame', category: 'decor', w: 20, d: 5, h: 25 },
  { name: 'stack of books', category: 'decor', w: 25, d: 20, h: 20 },
  { name: 'book', category: 'decor', w: 15, d: 3, h: 23 },
  { name: 'cushion', category: 'decor', w: 45, d: 15, h: 45 },
  { name: 'teddy bear', category: 'decor', w: 30, d: 25, h: 40 },
  { name: 'toy', category: 'decor', w: 25, d: 20, h: 25 },
  { name: 'aquarium', category: 'decor', w: 60, d: 30, h: 40 },
  { name: 'coat rack', category: 'decor', w: 50, d: 50, h: 180 },
  { name: 'laundry basket', category: 'decor', w: 50, d: 35, h: 55 },
  { name: 'trash can', category: 'decor', w: 30, d: 30, h: 60 },
  // Kitchen and table
  { name: 'water bottle', category: 'decor', w: 7, d: 7, h: 26 },
  { name: 'wine bottle', category: 'decor', w: 8, d: 8, h: 30 },
  { name: 'mug', category: 'decor', w: 12, d: 9, h: 10 },
  { name: 'wine glass', category: 'decor', w: 8, d: 8, h: 22 },
  { name: 'bowl', category: 'decor', w: 20, d: 20, h: 8 },
  { name: 'plate', category: 'decor', w: 27, d: 27, h: 3, by: 'w' },
  { name: 'jar', category: 'decor', w: 12, d: 12, h: 18 },
  { name: 'teapot', category: 'decor', w: 22, d: 15, h: 15 },
  { name: 'kettle', category: 'decor', w: 22, d: 16, h: 25 },
  { name: 'cooking pot', category: 'decor', w: 30, d: 25, h: 20 },
  { name: 'coffee maker', category: 'decor', w: 25, d: 30, h: 35 },
  { name: 'toaster', category: 'decor', w: 30, d: 18, h: 20 },
  { name: 'blender', category: 'decor', w: 18, d: 18, h: 40 },
  { name: 'microwave', category: 'decor', w: 50, d: 40, h: 30 },
  // Electronics and appliances
  { name: 'television', category: 'decor', w: 123, d: 8, h: 72 },
  { name: 'computer monitor', category: 'decor', w: 61, d: 20, h: 45 },
  { name: 'laptop', category: 'decor', w: 32, d: 24, h: 22 },
  { name: 'speaker', category: 'decor', w: 20, d: 20, h: 30 },
  { name: 'headphones', category: 'decor', w: 18, d: 8, h: 20 },
  { name: 'camera', category: 'decor', w: 13, d: 8, h: 10 },
  { name: 'printer', category: 'decor', w: 45, d: 35, h: 25 },
  { name: 'electric fan', category: 'decor', w: 40, d: 30, h: 120 },
  { name: 'space heater', category: 'decor', w: 30, d: 20, h: 50 },
  { name: 'air purifier', category: 'decor', w: 35, d: 35, h: 60 },
  { name: 'vacuum cleaner', category: 'decor', w: 30, d: 30, h: 110 },
  // Things people carry and play
  { name: 'suitcase', category: 'decor', w: 45, d: 28, h: 70 },
  { name: 'backpack', category: 'decor', w: 30, d: 18, h: 45 },
  { name: 'handbag', category: 'decor', w: 30, d: 15, h: 25 },
  { name: 'pair of shoes', category: 'decor', w: 30, d: 11, h: 12 },
  { name: 'guitar', category: 'decor', w: 38, d: 10, h: 100 },
  { name: 'upright piano', category: 'decor', w: 150, d: 60, h: 120 },
  { name: 'bicycle', category: 'decor', w: 170, d: 60, h: 100 },
  // Outside
  { name: 'patio chair', category: 'patio-chair', w: 60, d: 65, h: 85 },
  { name: 'patio table', category: 'patio-table', w: 90, d: 90, h: 72 },
  { name: 'sun lounger', category: 'lounger', w: 70, d: 190, h: 35, by: 'w' },
  { name: 'barbecue grill', category: 'decor', w: 120, d: 60, h: 110 },
];

// How CLIP is asked about each kind (scripts/build_scan_labels.html); the answers' average stands for it.
export const SCAN_PROMPTS = ['a photo of a {}.', 'a {} on a plain background.', 'a product photo of a {}.'];

export const kindTitle = (k: ScanKind) => k.name.charAt(0).toUpperCase() + k.name.slice(1);
