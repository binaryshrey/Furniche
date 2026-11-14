import type { Vec2 } from './types';

// Chain unordered wall edges (pairs of vertex ids) into one ordered polygon.
// Returns null when the edges do not form a single closed loop.
export function chainPolygon(edges: [string, string][], vertices: Record<string, Vec2>): Vec2[] | null {
  if (edges.length < 3) return null;
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  }
  const start = edges[0][0];
  const order = [start];
  let prev: string | null = null;
  let cur = start;
  for (let i = 0; i < edges.length; i++) {
    const next: string | undefined = (adj.get(cur) ?? []).find((v) => v !== prev && (v !== start || order.length > 2));
    if (!next) return null;
    if (next === start) break;
    order.push(next);
    prev = cur;
    cur = next;
  }
  if (order.length < 3) return null;
  const pts = order.map((id) => vertices[id]).filter(Boolean);
  return pts.length === order.length ? pts : null;
}

export function polygonArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function centroid(poly: Vec2[]): Vec2 {
  const n = poly.length || 1;
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// Corners of a w x d rectangle centred at c, rotated by rot (radians, counter-clockwise).
export function rectCorners(c: Vec2, w: number, d: number, rot: number): Vec2[] {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const hw = w / 2;
  const hd = d / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, y]) => ({ x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos }));
}

function project(poly: Vec2[], axis: Vec2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const v = p.x * axis.x + p.y * axis.y;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [min, max];
}

function axes(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
  }
  return out;
}

// Signed separation between two convex polygons along their best separating axis.
// Positive: the gap in metres. Negative: they overlap by that much.
export function convexSeparation(p: Vec2[], q: Vec2[]): number {
  let best = -Infinity;
  for (const ax of [...axes(p), ...axes(q)]) {
    const [a0, a1] = project(p, ax);
    const [b0, b1] = project(q, ax);
    const gap = Math.max(b0 - a1, a0 - b1);
    if (gap > best) best = gap;
  }
  return best;
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Smallest distance from any corner of a rectangle to the polygon boundary
// (only meaningful when the rectangle is inside the polygon).
export function minDistToBoundary(corners: Vec2[], poly: Vec2[]): number {
  let best = Infinity;
  for (const c of corners) {
    for (let i = 0; i < poly.length; i++) {
      best = Math.min(best, distPointSegment(c, poly[i], poly[(i + 1) % poly.length]));
    }
  }
  return best;
}

export function segmentsOfPolygon(poly: Vec2[]): [Vec2, Vec2][] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
}
