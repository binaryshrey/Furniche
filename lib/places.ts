// Approximate centres of well-known Houston neighbourhoods, for "in Montrose" style searches.
// The listing feed has no neighbourhood field, so a named place becomes a radius search.
export const PLACES: { names: string[]; lat: number; lon: number; km: number }[] = [
  { names: ['downtown'], lat: 29.7589, lon: -95.3677, km: 1.5 },
  { names: ['midtown'], lat: 29.7393, lon: -95.3778, km: 1.2 },
  { names: ['montrose'], lat: 29.7454, lon: -95.3926, km: 1.6 },
  { names: ['the heights', 'heights', 'houston heights'], lat: 29.798, lon: -95.398, km: 2.2 },
  { names: ['eado', 'east downtown'], lat: 29.7505, lon: -95.351, km: 1.2 },
  { names: ['washington avenue', 'washington ave'], lat: 29.77, lon: -95.395, km: 1.3 },
  { names: ['river oaks'], lat: 29.756, lon: -95.417, km: 1.6 },
  { names: ['upper kirby'], lat: 29.737, lon: -95.42, km: 1 },
  { names: ['greenway plaza', 'greenway'], lat: 29.731, lon: -95.435, km: 1 },
  { names: ['galleria', 'uptown'], lat: 29.7392, lon: -95.4613, km: 1.8 },
  { names: ['museum district'], lat: 29.723, lon: -95.39, km: 1.2 },
  { names: ['rice village', 'west university', 'west u'], lat: 29.717, lon: -95.423, km: 1.6 },
  { names: ['medical center', 'texas medical center', 'tmc'], lat: 29.707, lon: -95.401, km: 1.3 },
  { names: ['third ward'], lat: 29.729, lon: -95.36, km: 1.6 },
  { names: ['fifth ward'], lat: 29.775, lon: -95.335, km: 1.8 },
  { names: ['gulfton'], lat: 29.723, lon: -95.485, km: 1.4 },
  { names: ['bellaire'], lat: 29.7058, lon: -95.4588, km: 2 },
  { names: ['meyerland'], lat: 29.689, lon: -95.461, km: 1.8 },
  { names: ['sharpstown'], lat: 29.7, lon: -95.52, km: 2.5 },
  { names: ['westchase'], lat: 29.727, lon: -95.56, km: 2 },
  { names: ['memorial'], lat: 29.766, lon: -95.53, km: 3 },
  { names: ['spring branch'], lat: 29.8, lon: -95.51, km: 2.5 },
  { names: ['energy corridor'], lat: 29.78, lon: -95.61, km: 2.5 },
  { names: ['garden oaks', 'oak forest'], lat: 29.835, lon: -95.435, km: 2 },
  { names: ['katy'], lat: 29.7858, lon: -95.8245, km: 5 },
  { names: ['sugar land'], lat: 29.6197, lon: -95.6349, km: 6 },
  { names: ['pearland'], lat: 29.5636, lon: -95.286, km: 5 },
  { names: ['pasadena'], lat: 29.6911, lon: -95.2091, km: 5 },
  { names: ['clear lake'], lat: 29.555, lon: -95.11, km: 4 },
  { names: ['cypress'], lat: 29.9691, lon: -95.6972, km: 6 },
  { names: ['spring'], lat: 30.0799, lon: -95.4172, km: 5 },
  { names: ['humble'], lat: 29.9988, lon: -95.2622, km: 4 },
  { names: ['kingwood'], lat: 30.05, lon: -95.185, km: 5 },
  { names: ['the woodlands', 'woodlands'], lat: 30.1658, lon: -95.4613, km: 6 },
];

export function placeNamed(name: string) {
  const n = name.toLowerCase().trim();
  return PLACES.find((p) => p.names.includes(n)) ?? null;
}

export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}
