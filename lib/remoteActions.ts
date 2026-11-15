'use client';
import * as THREE from 'three';
import { toThree } from './coords';
import { minDistToBoundary, pointInPolygon } from './geometry';
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
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
  dx = Math.max(-90, Math.min(90, dx));
  dy = Math.max(-45, Math.min(45, dy));
  pending = { dx: pending.dx + dx, dy: pending.dy + dy };
  if (turning || !sdk) return;
  turning = true;
  try {
    while (Math.abs(pending.dx) > 0.2 || Math.abs(pending.dy) > 0.2) {
      const step = pending;
      pending = { dx: 0, dy: 0 };
      if (!Number.isFinite(step.dx) || !Number.isFinite(step.dy)) continue; // never rotate by NaN
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
    transitStart = sw?.sid ? 0 : transitStart || Date.now();
  });
  sdk.Camera.pose.subscribe((p: { position?: { x: number; y: number; z: number } }) => {
    const q = p?.position;
    cameraLost = !!q && ![q.x, q.y, q.z].every((v) => typeof v === 'number' && Number.isFinite(v));
  });
}
// Showcase can leave the camera at NaN after a failed transition: that renders black.
let cameraLost = false;

const OUTSIDE = /patio|deck|porch|balcony|yard|garden|exterior|outdoor|terrace|driveway|roof|garage/i;

// Viewpoints that turned out to show a black screen; never go there again this session.
const dark = new Set<string>();

// Signs Showcase is showing a black frame, without asking it for a screenshot (its screenshot
// call resizes the camera and can itself leave it at NaN): the camera position is NaN, or a move
// has been in flight (no current sweep) for too long.
let transitStart = 0;
function looksBlack(): boolean {
  return cameraLost || (transitStart > 0 && Date.now() - transitStart > 8000);
}

// A viewpoint you may be taken to: enabled, aligned, and standing inside one of the home's rooms.
export function isInside(id: string, geometry: ModelGeometry): boolean {
  const info = sweeps[id];
  // Once Matterport has listed the sweeps of the current view, anything missing from that list has
  // no imagery in this view (moving there shows black), so it doesn't count.
  if (!info && Object.keys(sweeps).length) return false;
  if (info && (info.enabled === false || (info.alignmentType && info.alignmentType !== 'aligned'))) return false;
  if (dark.has(id)) return false;
  const pano = geometry.panos.find((p) => p.id === id);
  if (!pano) return false;
  // Inside a room on the viewpoint's own floor (an outdoor viewpoint can sit under an upstairs
  // room's outline), and not hugging the outline, where viewpoints peer out through doors.
  return geometry.rooms.some(
    (r) =>
      !OUTSIDE.test(r.label) &&
      (pano.floorId ? pano.floorId === r.floorId : pano.pos.z > r.floorZ && pano.pos.z < r.floorZ + 2.6) &&
      pointInPolygon(pano.pos, r.polygon) &&
      minDistToBoundary([pano.pos], r.polygon) > 0.2,
  );
}

// While the phone drives the tour, never leave the building: if the camera lands on a viewpoint
// outside (where the scan turns black), fly back to the last one inside.
export function guardInside(sdk: Sdk, geometry: ModelGeometry | null, moveToPano: (sdk: Sdk, id: string) => Promise<boolean>, strict = true): () => void {
  if (!sdk || !geometry) return () => {};
  watch(sdk);
  let lastInside: string | null = null;
  let returning = false;
  let check: ReturnType<typeof setTimeout> | undefined;
  const goBack = async () => {
    if (!lastInside || returning) return;
    returning = true;
    await moveToPano(sdk, lastInside).catch(() => false);
    returning = false;
  };
  const sub = sdk.Sweep.current.subscribe(async (sw: { sid?: string }) => {
    clearTimeout(check);
    if (!sw?.sid || returning) return;
    const id = bare(sw.sid);
    if (strict && !isInside(id, geometry)) return void goBack();
    // Inside by the plan; make sure the camera is sound once the move has settled.
    check = setTimeout(() => {
      if (returning) return;
      if (looksBlack()) {
        dark.add(id);
        if (lastInside && lastInside !== id) return void goBack();
      } else lastInside = id;
    }, 1400);
  });
  // Watchdog: a black frame can also appear without a viewpoint change (a transition that
  // failed half way). Two black readings in a row: fly to the last good viewpoint, or failing
  // that the nearest viewpoint inside the building.
  let blackRuns = 0;
  let rescues = 0;
  const dog = setInterval(async () => {
    if (returning || document.hidden) return;
    if (!looksBlack()) {
      blackRuns = 0;
      rescues = 0;
      if (currentSweep && isInside(currentSweep, geometry)) lastInside = currentSweep;
      return;
    }
    if (++blackRuns < 2) return;
    blackRuns = 0;
    if (currentSweep) dark.add(currentSweep);
    let target = lastInside && lastInside !== currentSweep ? lastInside : null;
    if (!target) {
      const here = geometry.panos.find((p) => p.id === currentSweep);
      const cands = geometry.panos.filter((p) => p.id !== currentSweep && isInside(p.id, geometry));
      if (here) cands.sort((a, b) => Math.hypot(a.pos.x - here.pos.x, a.pos.y - here.pos.y) - Math.hypot(b.pos.x - here.pos.x, b.pos.y - here.pos.y));
      target = cands[0]?.id ?? null;
    }
    // A fly-back already failed to fix it: Showcase itself is stuck, so start a fresh viewer.
    if (!target || ++rescues > 1) {
      rescues = 0;
      window.dispatchEvent(new Event('fn-viewer-reset'));
      return;
    }
    returning = true;
    // A move into a stuck Showcase may never settle: give up waiting after a few seconds.
    await Promise.race([moveToPano(sdk, target).catch(() => false), wait(6000)]);
    returning = false;
  }, 2500);
  return () => {
    clearTimeout(check);
    clearInterval(dog);
    sub?.cancel?.();
  };
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
