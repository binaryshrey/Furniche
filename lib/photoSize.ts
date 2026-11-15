import type { Category, Product } from './types';

// A model made from a photo has no size of its own: image-to-3D output is normalised to a unit
// cube. It keeps its own proportions, and one known measurement scales all of it, so the piece
// is never stretched.

// Bounding-box extents in three.js axes: x = width, y = height, z = depth (front faces +Z).
export type Extents = { x: number; y: number; z: number };
export type Axis = 'w' | 'd' | 'h';
export type DimsCm = { w: number; d: number; h: number };

// The model's extents once turned by `yaw` about the vertical axis (three.js rotation.y).
// points: the model's vertices as x, y, z, x, y, z, …
export function extentsAt(points: ArrayLike<number>, yaw: number): Extents {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let [x0, x1, y0, y1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = points[i] * c + points[i + 2] * s;
    const z = -points[i] * s + points[i + 2] * c;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, points[i + 1]);
    y1 = Math.max(y1, points[i + 1]);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return x1 < x0 ? { x: 0, y: 0, z: 0 } : { x: x1 - x0, y: y1 - y0, z: z1 - z0 };
}

function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return p.length < 3 ? p : [...half(p), ...half([...p].reverse())];
}

// The turn, within ±45°, that lines the footprint's smallest bounding rectangle up with the axes.
// A piece photographed at an angle comes out of image-to-3D turned by that angle; this squares it
// up, so its footprint (and the fit check) hugs it. The side that faced the camera stays in front.
export function squareAngle(points: ArrayLike<number>, maxPoints = 4000): number {
  const n = Math.floor(points.length / 3);
  const step = Math.max(1, Math.floor(n / maxPoints));
  const footprint: [number, number][] = [];
  for (let i = 0; i < n; i += step) footprint.push([points[i * 3], points[i * 3 + 2]]);
  const h = hull(footprint);
  if (h.length < 3) return 0;
  const flat = h.flatMap(([x, z]) => [x, 0, z]);
  let best = 0;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const [a, b] = [h[i], h[(i + 1) % h.length]];
    // Turning by an edge's own angle lays that edge along the x axis; quarter turns are the same rectangle.
    let yaw = Math.atan2(b[1] - a[1], b[0] - a[0]) % (Math.PI / 2);
    if (yaw > Math.PI / 4) yaw -= Math.PI / 2;
    if (yaw <= -Math.PI / 4) yaw += Math.PI / 2;
    const e = extentsAt(flat, yaw);
    if (e.x * e.z < bestArea - 1e-12) [best, bestArea] = [yaw, e.x * e.z];
  }
  return best;
}

// Width × depth × height in whole centimetres, with `axis` measuring `cm` and the rest in proportion.
export function scaledDims(e: Extents, axis: Axis, cm: number): DimsCm {
  const along = { w: e.x, d: e.z, h: e.y }[axis];
  const k = cm / Math.max(along, 1e-6);
  const r = (v: number) => Math.max(1, Math.round(v * k));
  return { w: r(e.x), d: r(e.z), h: r(e.y) };
}

// The measurement people know for a kind of piece: a rug by its width, everything else by height.
export const knownAxis = (c: Category): Axis => (c === 'rug' ? 'w' : 'h');

// The middle catalogue size of this kind of piece: a starting point when nothing better is known.
export function typicalCm(category: Category, axis: Axis, products: Product[]): number {
  const vals = products
    .filter((p) => p.source === 'curated' && p.category === category)
    .map((p) => p.dimsCm[axis])
    .sort((a, b) => a - b);
  if (!vals.length) return axis === 'h' ? 80 : 120;
  return vals[Math.floor(vals.length / 2)];
}
