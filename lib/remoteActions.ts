'use client';
import * as THREE from 'three';
import { toThree } from './coords';
import { pointInPolygon } from './geometry';
import { bridge } from './sceneBridge';
import type { ModelGeometry } from './types';

// What the screen does when the phone remote sends a command. Camera moves go through the
// Matterport SDK; directions are checked against our three.js camera (kept in step with
// Matterport's), so "look right" turns right whatever sign convention the SDK uses.

type Sdk = any;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function forward(): THREE.Vector3 | null {
  const cam = bridge.camera;
  if (!cam) return null;
  cam.updateMatrixWorld();
  return new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

// +1 if Camera.rotate's positive horizontal turns the view right, -1 if left (learned once).
let hSign = 0;
let vSign = 0;

// Turn by (dx right, dy up) degrees. Requests that arrive while a turn is running are merged.
let pending = { dx: 0, dy: 0 };
let turning = false;
export async function look(sdk: Sdk, dx: number, dy: number) {
  pending = { dx: pending.dx + dx, dy: pending.dy + dy };
  if (turning || !sdk) return;
  turning = true;
  try {
    while (Math.abs(pending.dx) > 0.2 || Math.abs(pending.dy) > 0.2) {
      const step = pending;
      pending = { dx: 0, dy: 0 };
      const before = forward();
      const sh = hSign || 1;
      const sv = vSign || 1;
      await sdk.Camera.rotate(sh * step.dx, sv * step.dy, { speed: 240 }).catch(() => {});
      await wait(30);
      const after = forward();
      // Learn the sign from the first real turn: compare where the view went with where we asked.
      if (before && after) {
        if (!hSign && Math.abs(step.dx) > 2) {
          // Seen from above (three.js: +X right, -Z ahead), turning right swings the view toward +X.
          const turnedRight = before.x * after.z - before.z * after.x > 0;
          hSign = turnedRight === step.dx > 0 ? sh : -sh;
          if (hSign !== sh) pending.dx += 2 * step.dx; // went the wrong way: undo and redo
        }
        if (!vSign && Math.abs(step.dy) > 2) {
          const wentUp = after.y > before.y;
          vSign = wentUp === step.dy > 0 ? sv : -sv;
          if (vSign !== sv) pending.dy += 2 * step.dy;
        }
      }
    }
  } finally {
    turning = false;
  }
}

// ---- Staying inside the building ----
// Matterport's own sweep graph: which viewpoints are enabled, aligned, and linked to which.
type SweepInfo = { enabled?: boolean; alignmentType?: string; neighbors?: string[] };
let sweeps: Record<string, SweepInfo> = {};
let currentSweep: string | null = null;
let watched: Sdk = null;
// In an alternate view (the furniture-removed one) Matterport names sweeps "<viewId>:<sweepId>";
// the Model API's panos use the bare sweep id, so compare on that.
export const bare = (id: string) => id.slice(id.lastIndexOf(':') + 1);
function watch(sdk: Sdk) {
  if (!sdk || watched === sdk) return;
  watched = sdk;
  sdk.Sweep.data.subscribe({
    onCollectionUpdated: (c: Record<string, SweepInfo>) => {
      const next: Record<string, SweepInfo> = {};
      for (const [k, v] of Object.entries(c)) next[bare(k)] = { ...v, neighbors: (v.neighbors ?? []).map(bare) };
      sweeps = next;
    },
  });
  sdk.Sweep.current.subscribe((sw: { sid?: string }) => {
    if (sw?.sid) currentSweep = bare(sw.sid); // empty mid-transition; keep the last real one
  });
}

const OUTSIDE = /patio|deck|porch|balcony|yard|garden|exterior|outdoor|terrace|driveway|roof/i;

// A viewpoint you may be taken to: enabled, aligned, and standing inside one of the home's rooms.
export function isInside(id: string, geometry: ModelGeometry): boolean {
  const info = sweeps[id];
  // Once Matterport has listed the sweeps of the current view, anything missing from that list has
  // no imagery in this view (moving there shows black), so it doesn't count.
  if (!info && Object.keys(sweeps).length) return false;
  if (info && (info.enabled === false || (info.alignmentType && info.alignmentType !== 'aligned'))) return false;
  const pano = geometry.panos.find((p) => p.id === id);
  if (!pano) return false;
  return geometry.rooms.some((r) => !OUTSIDE.test(r.label) && pointInPolygon(pano.pos, r.polygon));
}

// While the phone drives the tour, never leave the building: if the camera lands on a viewpoint
// outside (where the scan turns black), fly back to the last one inside.
export function guardInside(sdk: Sdk, geometry: ModelGeometry | null, moveToPano: (sdk: Sdk, id: string) => Promise<boolean>): () => void {
  if (!sdk || !geometry) return () => {};
  watch(sdk);
  let lastInside: string | null = null;
  let returning = false;
  const sub = sdk.Sweep.current.subscribe(async (sw: { sid?: string }) => {
    if (!sw?.sid || returning) return;
    const id = bare(sw.sid);
    if (isInside(id, geometry)) return void (lastInside = id);
    if (!lastInside) return;
    returning = true;
    await moveToPano(sdk, lastInside).catch(() => false);
    returning = false;
  });
  return () => sub?.cancel?.();
}

// Step to the next viewpoint ahead (or behind): only one Matterport links to the current one,
// inside the building, within a few metres and roughly in the direction you face. Nothing
// suitable? Stay put and say why.
export async function step(
  sdk: Sdk,
  geometry: ModelGeometry | null,
  dir: 'forward' | 'back',
  moveToPano: (sdk: Sdk, id: string) => Promise<boolean>,
): Promise<{ moved: boolean; note: string }> {
  const f = forward();
  if (!sdk || !geometry || !f) return { moved: false, note: 'The tour is still loading.' };
  watch(sdk);
  await wait(50);
  const here = geometry.panos.find((p) => p.id === currentSweep);
  if (!here) return { moved: false, note: 'Finding where you are…' };
  const ahead = new THREE.Vector2(f.x, f.z).normalize().multiplyScalar(dir === 'forward' ? 1 : -1);
  const [hx, , hz] = toThree(here.pos);
  const linked = sweeps[here.id]?.neighbors;
  let best: { id: string; score: number } | null = null;
  for (const p of geometry.panos) {
    if (p.id === here.id) continue;
    if (linked?.length && !linked.includes(p.id)) continue; // only the next circle along
    if (!isInside(p.id, geometry)) continue;
    const [x, , z] = toThree(p.pos);
    const v = new THREE.Vector2(x - hx, z - hz);
    const d = v.length();
    if (d < 0.3 || d > 3.2) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, v.normalize().dot(ahead))));
    if (angle > (55 * Math.PI) / 180) continue;
    const score = d + angle * 2; // nearest first, straight ahead preferred
    if (!Number.isFinite(score)) continue;
    if (!best || score < best.score) best = { id: p.id, score };
  }
  if (!best) return { moved: false, note: dir === 'forward' ? 'No viewpoint ahead. Turn and try again.' : 'No viewpoint behind you.' };
  const moved = await moveToPano(sdk, best.id);
  if (moved) currentSweep = best.id; // don't wait for the SDK to report it before the next step
  return { moved, note: moved ? '' : 'Couldn’t move there. Try turning a little.' };
}

// Rooms you can jump to from the phone: only those with a viewpoint inside the building.
export function interiorPano(geometry: ModelGeometry, roomId: string) {
  const room = geometry.rooms.find((r) => r.id === roomId);
  if (!room || OUTSIDE.test(room.label)) return null;
  const inside = geometry.panos.filter((p) => pointInPolygon(p.pos, room.polygon) && isInside(p.id, geometry));
  if (!inside.length) return null;
  const cx = room.polygon.reduce((s, q) => s + q.x, 0) / room.polygon.length;
  const cy = room.polygon.reduce((s, q) => s + q.y, 0) / room.polygon.length;
  return [...inside].sort((a, b) => Math.hypot(a.pos.x - cx, a.pos.y - cy) - Math.hypot(b.pos.x - cx, b.pos.y - cy))[0];
}
