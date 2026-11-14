import type { ThemeId } from '@/lib/types';

export type Theme = {
  id: ThemeId;
  name: string;
  blurb: string;
  palette: string[];
  wallPaint: string; // material id
  floor: string; // material id
  keywords: string[];
};

export const THEMES: Theme[] = [
  {
    id: 'midcentury',
    name: 'Midcentury',
    blurb: 'Walnut, tapered legs, mustard and teal accents.',
    palette: ['#7b5236', '#d9a441', '#2f6f6a', '#efe9de', '#3a2f2a'],
    wallPaint: 'paint-swiss-coffee',
    floor: 'floor-walnut',
    keywords: ['walnut', 'retro', '60s', 'mad men', 'teak', 'tapered'],
  },
  {
    id: 'japandi',
    name: 'Japandi',
    blurb: 'Pale oak, linen, low profiles, calm neutrals.',
    palette: ['#cfb38b', '#e8e1d4', '#8c8173', '#3b3833', '#f5f2ec'],
    wallPaint: 'paint-greige',
    floor: 'floor-white-oak',
    keywords: ['calm', 'zen', 'minimal', 'oak', 'linen', 'warm minimal'],
  },
  {
    id: 'scandinavian',
    name: 'Scandinavian',
    blurb: 'Light wood, white walls, soft grey textiles.',
    palette: ['#f4f4f1', '#d9c09a', '#a7a9a6', '#5b5d60', '#e8e4dc'],
    wallPaint: 'paint-chalk-white',
    floor: 'floor-white-oak',
    keywords: ['nordic', 'bright', 'light', 'hygge', 'white'],
  },
  {
    id: 'industrial',
    name: 'Industrial',
    blurb: 'Black metal, dark wood, concrete greys.',
    palette: ['#3d4042', '#5a4636', '#9a9893', '#c9c3b8', '#1f1f1f'],
    wallPaint: 'paint-iron-grey',
    floor: 'floor-concrete',
    keywords: ['loft', 'metal', 'urban', 'concrete', 'dark'],
  },
  {
    id: 'coastal',
    name: 'Coastal',
    blurb: 'Whitewashed wood, jute, sea-glass blues.',
    palette: ['#ece8df', '#cdb48d', '#8fb3c4', '#3e5a6b', '#f7f5f0'],
    wallPaint: 'paint-sea-salt',
    floor: 'floor-white-oak',
    keywords: ['beach', 'breezy', 'blue', 'jute', 'malibu'],
  },
  {
    id: 'modern-organic',
    name: 'Modern Organic',
    blurb: 'Bouclé, travertine, curves and plants.',
    palette: ['#efe9de', '#d9cbb4', '#b98b62', '#4c6b45', '#2e2a26'],
    wallPaint: 'paint-greige',
    floor: 'floor-white-oak',
    keywords: ['warm', 'curves', 'boucle', 'travertine', 'earthy', 'plants'],
  },
];

export const themeById = (id: ThemeId) => THEMES.find((t) => t.id === id)!;
