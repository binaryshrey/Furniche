// Sample finishes. Prices are approximate retail; coverage figures are typical label values.
export type Material =
  | { id: string; kind: 'paint'; name: string; brand: string; color: string; priceUsd: number; unit: 'gallon'; coverageSqFt: number }
  | { id: string; kind: 'wallpaper'; name: string; brand: string; color: string; accent: string; priceUsd: number; unit: 'roll'; coverageSqFt: number }
  | { id: string; kind: 'floor'; name: string; brand: string; color: string; priceUsd: number; unit: 'sq ft' };

export const PAINT_COATS = 2;
export const OPENING_ALLOWANCE = 0.15; // share of wall area assumed to be windows and doorways
export const DOOR_AREA_SQFT = 21; // 32 x 80 in door
export const FLOOR_WASTE = 0.1;

export const MATERIALS: Material[] = [
  { id: 'paint-chalk-white', kind: 'paint', name: 'Chalk White', brand: 'Interior eggshell', color: '#f3f1ea', priceUsd: 52, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-swiss-coffee', kind: 'paint', name: 'Swiss Coffee', brand: 'Interior eggshell', color: '#ece4d4', priceUsd: 52, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-greige', kind: 'paint', name: 'Agreeable Greige', brand: 'Interior eggshell', color: '#d1c7b7', priceUsd: 58, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-sea-salt', kind: 'paint', name: 'Sea Salt', brand: 'Interior eggshell', color: '#cdd8cf', priceUsd: 58, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-sage', kind: 'paint', name: 'Sage Leaf', brand: 'Interior eggshell', color: '#a9b49a', priceUsd: 58, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-terracotta', kind: 'paint', name: 'Terracotta Clay', brand: 'Interior eggshell', color: '#c27c5c', priceUsd: 62, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-iron-grey', kind: 'paint', name: 'Iron Ore', brand: 'Interior eggshell', color: '#4a4b4c', priceUsd: 62, unit: 'gallon', coverageSqFt: 350 },
  { id: 'paint-navy', kind: 'paint', name: 'Hale Navy', brand: 'Interior eggshell', color: '#3a4a5c', priceUsd: 62, unit: 'gallon', coverageSqFt: 350 },
  { id: 'wp-linen-stripe', kind: 'wallpaper', name: 'Linen Stripe', brand: 'Peel-and-stick', color: '#e9e2d3', accent: '#d2c6af', priceUsd: 45, unit: 'roll', coverageSqFt: 30 },
  { id: 'wp-botanical', kind: 'wallpaper', name: 'Botanical Trail', brand: 'Peel-and-stick', color: '#dfe5d8', accent: '#6f8a62', priceUsd: 55, unit: 'roll', coverageSqFt: 30 },
  { id: 'wp-grasscloth', kind: 'wallpaper', name: 'Natural Grasscloth', brand: 'Traditional paste', color: '#cbb48b', accent: '#b39a6f', priceUsd: 89, unit: 'roll', coverageSqFt: 56 },
  { id: 'floor-white-oak', kind: 'floor', name: 'White Oak LVP', brand: 'Luxury vinyl plank', color: '#cdb38e', priceUsd: 3.29, unit: 'sq ft' },
  { id: 'floor-walnut', kind: 'floor', name: 'Walnut Engineered', brand: 'Engineered hardwood', color: '#7a5638', priceUsd: 6.49, unit: 'sq ft' },
  { id: 'floor-concrete', kind: 'floor', name: 'Concrete Look Tile', brand: 'Porcelain tile', color: '#a19d96', priceUsd: 2.99, unit: 'sq ft' },
  { id: 'floor-herringbone', kind: 'floor', name: 'Herringbone Oak', brand: 'Engineered hardwood', color: '#b8915f', priceUsd: 7.99, unit: 'sq ft' },
];

export const materialById = (id: string) => MATERIALS.find((m) => m.id === id);

const SQFT = 10.7639;

export function wallAreaSqFt(perimeterM: number, heightM: number, doors: number): number {
  const gross = perimeterM * heightM * SQFT;
  return Math.max(0, gross * (1 - OPENING_ALLOWANCE) - doors * DOOR_AREA_SQFT);
}

export function quantityFor(m: Material, areaSqFt: number): { qty: number; unit: string; cost: number } {
  if (m.kind === 'paint') {
    const qty = Math.ceil((areaSqFt * PAINT_COATS) / m.coverageSqFt);
    return { qty, unit: qty === 1 ? 'gallon' : 'gallons', cost: qty * m.priceUsd };
  }
  if (m.kind === 'wallpaper') {
    const qty = Math.ceil((areaSqFt * 1.15) / m.coverageSqFt); // 15% for pattern matching
    return { qty, unit: qty === 1 ? 'roll' : 'rolls', cost: qty * m.priceUsd };
  }
  const qty = Math.ceil(areaSqFt * (1 + FLOOR_WASTE));
  return { qty, unit: 'sq ft', cost: qty * m.priceUsd };
}
