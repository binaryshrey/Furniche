'use client';
import * as THREE from 'three';
import { distPointSegment, pointInPolygon, segmentsOfPolygon } from './geometry';
import { bridge, groundY } from './sceneBridge';
import type { Room, Vec2 } from './types';

// What the room actually looks like, read from Matterport's scanned mesh with rays:
//   - doorways: along the room outline, the scan has no surface from the floor to head height
//     (the Model API's walls run straight across doors, so this is the only way to find them)
//   - windows: solid below the sill, open above it (glass scans as holes)
//   - fixtures: something solid standing on the floor that isn't a wall: counters, islands,
//     built-ins, radiators, a fireplace hearth. Skipped on models with a defurnished view,
//     where the mesh still holds the seller's furniture.
// All in Model API coordinates (x, y on the floor; three.js is (x, z, -y)).

export type Opening = { a: Vec2; b: Vec2; mid: Vec2; widthM: number };
export type RoomSense = { doors: Opening[]; windows: Opening[]; fixtures: Vec2[][] };

const STEP = 0.1;
const INSET = 0.35; // rays start this far inside the outline (which runs mid-wall)
const REACH = 0.85; // and look this far out: wall centre plus the thickest walls
const GRID = 0.2;

const ray = new THREE.Raycaster();
ray.layers.enableAll();

function solidAt(origin: THREE.Vector3, dir: THREE.Vector3, far: number): boolean {
  ray.set(origin, dir);
  ray.far = far;
  return ray.intersectObjects(bridge.scan, false).length > 0;
}

// Contiguous runs of `true` along a segment, as openings at least `minW` wide.
function runs(flags: boolean[], a: Vec2, b: Vec2, minW: number): Opening[] {
  const out: Opening[] = [];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const at = (k: number): Vec2 => ({ x: a.x + ((b.x - a.x) * k) / (flags.length - 1 || 1), y: a.y + ((b.y - a.y) * k) / (flags.length - 1 || 1) });
  let start = -1;
  for (let k = 0; k <= flags.length; k++) {
    if (k < flags.length && flags[k]) {
      if (start < 0) start = k;
      continue;
    }
    if (start >= 0) {
      const w = ((k - 1 - start) / (flags.length - 1 || 1)) * len;
      if (w >= minW) {
        const pa = at(start);
        const pb = at(k - 1);
        out.push({ a: pa, b: pb, mid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, widthM: w });
      }
      start = -1;
    }
  }
  return out;
}

export function senseRoom(room: Room, opts: { fixtures?: boolean } = {}): RoomSense | null {
  if (!bridge.scan.length) return null;
  const floorAt = (p: Vec2) => groundY(p.x, -p.y, room.floorZ);
  const doors: Opening[] = [];
  const windows: Opening[] = [];

  for (const [a, b] of segmentsOfPolygon(room.polygon)) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) continue;
    const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let n = { x: -t.y, y: t.x }; // inward normal
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!pointInPolygon({ x: mid.x + n.x * 0.15, y: mid.y + n.y * 0.15 }, room.polygon)) n = { x: t.y, y: -t.x };
    const out = new THREE.Vector3(-n.x, 0, n.y); // outward, in three.js
    const steps = Math.max(2, Math.round(len / STEP));
    const door: boolean[] = [];
    const win: boolean[] = [];
    for (let k = 0; k <= steps; k++) {
      // Keep clear of the corners, where the neighbouring wall answers instead.
      const s = Math.min(Math.max((k / steps) * len, 0.15), len - 0.15);
      const p = { x: a.x + t.x * s + n.x * INSET, y: a.y + t.y * s + n.y * INSET };
      const y0 = floorAt(p);
      const hit = (h: number) => solidAt(new THREE.Vector3(p.x, y0 + h, -p.y), out, REACH);
      const low = hit(0.35);
      const waist = hit(1.1);
      const head = hit(1.75);
      door.push(!low && !waist && !head);
      win.push(low && !waist);
    }
    doors.push(...runs(door, a, b, 0.6));
    windows.push(...runs(win, a, b, 0.4));
  }

  const fixtures: Vec2[][] = [];
  if (opts.fixtures !== false) {
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    const walls = segmentsOfPolygon(room.polygon);
    const DOWN = new THREE.Vector3(0, -1, 0);
    for (let x = Math.min(...xs) + GRID / 2; x < Math.max(...xs); x += GRID) {
      for (let y = Math.min(...ys) + GRID / 2; y < Math.max(...ys); y += GRID) {
        const p = { x, y };
        if (!pointInPolygon(p, room.polygon) || walls.some(([a, b]) => distPointSegment(p, a, b) < 0.15)) continue;
        const y0 = floorAt(p);
        // Look down from below a ceiling fan's reach: the first surface is the floor or a fixture.
        ray.set(new THREE.Vector3(x, y0 + 1.4, -y), DOWN);
        ray.far = 1.4;
        const first = ray.intersectObjects(bridge.scan, false)[0];
        if (first && first.point.y - y0 > 0.12) {
          const h = GRID / 2;
          fixtures.push([{ x: x - h, y: y - h }, { x: x + h, y: y - h }, { x: x + h, y: y + h }, { x: x - h, y: y + h }]);
        }
      }
    }
  }
  return { doors, windows, fixtures };
}
