'use client';
import * as THREE from 'three';
import { toThree } from './coords';
import { bridge } from './sceneBridge';
import { centroid, minDistToBoundary, pointInPolygon } from './geometry';
import type { ModelGeometry, Pano, PlacedItem, Vec2 } from './types';

// Bring furniture into view: stand at a good spot in its room and face it, the way a visitor
// walking in would see it. Used after Auto-furnish (the whole arrangement) and when a piece is
// picked in My design (just that piece).

type Sdk = any;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Matterport yaw (degrees) that points the camera from `from` toward `to`, both in three.js
// coordinates. Yaw 0 looks down -Z and, like Camera.rotate, grows clockwise seen from above:
// turning toward +X is positive. (A 180° target looks the same either way; the clockwise sign
// was confirmed by aiming at pieces off to one side.)
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180) / Math.PI;
}

// The pano in the room that sees the target best: inside the room, about `back` metres away
// (standing in the middle of the pieces hides most of them).
export function viewpoint(room: { polygon: Vec2[] }, panos: Pano[], target: Vec2, back = 3.2): Pano | null {
  return viewpoints(room, panos, target, back)[0] ?? null;
}

// Every pano in the room, best viewpoint first (some can't be moved to, so callers try the next).
export function viewpoints(room: { polygon: Vec2[] }, panos: Pano[], target: Vec2, back = 3.2): Pano[] {
  const inside = panos.filter((p) => pointInPolygon(p.pos, room.polygon));
  // Close to the wanted distance, and never right on top of the pieces.
  const score = (p: Pano) => {
    const d = Math.hypot(p.pos.x - target.x, p.pos.y - target.y);
    const wall = minDistToBoundary([p.pos], room.polygon); // a pano pressed against a wall frames badly
    return -Math.abs(d - back) - (d < 1.5 ? 10 : 0) - (wall < 0.7 ? 3 : 0);
  };
  return [...inside].sort((a, b) => score(b) - score(a));
}

let running = 0;

// Where the camera actually stands: the current sweep's position (three.js frame), which is
// exact once a move has finished. Camera.pose can report NaN right after a move.
function currentSweep(sdk: Sdk): Promise<{ sid: string; x: number; z: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { sid: string; x: number; z: number } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const sub = sdk.Sweep.current.subscribe((sw: any) => {
      const p = sw?.position;
      // Mid-transition the SDK reports an empty sweep at (0, 0); wait for a real one.
      if (!sw?.sid || !p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return;
      finish({ sid: sw.sid, x: p.x, z: p.z });
      setTimeout(() => sub?.cancel?.(), 0);
    });
    setTimeout(() => (finish(null), sub?.cancel?.()), 2500);
  });
}

export async function lookAt(opts: {
  sdk: Sdk;
  geometry: ModelGeometry;
  roomId: string;
  target?: Vec2; // defaults to the middle of the room's furniture
  items?: PlacedItem[];
  back?: number;
  pitch?: number; // where the target should sit vertically, degrees from the view centre (negative = below)
  yawOffset?: number; // how far left of centre the target should sit, degrees (to clear the side panel)
  moveToPano: (sdk: Sdk, panoId: string) => Promise<boolean>;
}): Promise<void> {
  const { sdk, geometry, roomId, moveToPano } = opts;
  const room = geometry.rooms.find((r) => r.id === roomId);
  if (!sdk || !room) return;
  const run = ++running;
  const mine = (opts.items ?? []).filter((i) => i.roomId === roomId);
  const target = opts.target ?? (mine.length ? centroid(mine.map((i) => ({ x: i.pos.x, y: i.pos.y }))) : centroid(room.polygon));

  // Fly to the best viewpoint, or the next-best if Matterport refuses one. Only fly moves: an
  // instant jump to a pano whose imagery isn't loaded yet throws PanoTilingError and leaves the
  // tour black. Already standing at a good viewpoint? Don't move at all (Matterport rejects a
  // move to the current sweep). Never turn toward the piece from another room.
  const inRoom = (p: { x: number; z: number } | null) => !!p && pointInPolygon({ x: p.x, y: -p.z }, room.polygon);
  const candidates = viewpoints(room, geometry.panos, target, opts.back).slice(0, 4);
  if (!candidates.length) return;
  let at: { x: number; z: number } | null = null;
  const here = await currentSweep(sdk);
  const good = here && candidates.slice(0, 2).find((c) => c.id === here.sid);
  if (good) {
    const [x, , z] = toThree(good.pos);
    at = { x, z };
  }
  for (const pano of at ? [] : candidates) {
    if (run !== running) return;
    // A move that resolves put the camera on that pano, whose position is exact.
    if (await moveToPano(sdk, pano.id)) {
      const [x, , z] = toThree(pano.pos);
      at = { x, z };
      break;
    }
    // Otherwise ask where the camera ended up; anywhere in the room will do.
    const seen = await currentSweep(sdk);
    if (inRoom(seen)) {
      at = seen;
      break;
    }
  }
  await wait(500);
  if (run !== running || !at) return;
  const [px, pz] = [at.x, at.z];
  const [tx, ty, tz] = toThree({ x: target.x, y: target.y, z: room.floorZ + 0.45 }); // middle height of furniture
  const wantH = -(opts.yawOffset ?? 0);
  const wantE = opts.pitch ?? -6;

  // First a rough turn from the angle maths, then correct against the live view (below), so the
  // result doesn't depend on Matterport's yaw sign convention.
  try {
    await sdk.Camera.setRotation({ x: -15, y: yawToward({ x: px, z: pz }, { x: tx, z: tz }) }, { speed: 120 });
  } catch {
    /* corrected below */
  }
  await aimAt(sdk, new THREE.Vector3(tx, ty, tz), wantH, wantE, () => run === running);
}

// Where a point is relative to the view centre, in degrees: h > 0 to the right, e > 0 above.
// Uses our three.js camera, which FurnitureLayer keeps in step with Matterport's every frame.
function offAxis(p: THREE.Vector3): { h: number; e: number } | null {
  const cam = bridge.camera;
  if (!cam) return null;
  cam.updateMatrixWorld();
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse); // camera space: -Z ahead, +X right, +Y up
  const deg = 180 / Math.PI;
  return { h: Math.atan2(v.x, -v.z) * deg, e: Math.atan2(v.y, Math.hypot(v.x, v.z)) * deg };
}

// Turn the camera until the point sits at (wantH, wantE). Camera.rotate's documented sign is
// "positive = clockwise / up"; if a step makes things worse, the sign is flipped and retried.
async function aimAt(sdk: Sdk, p: THREE.Vector3, wantH: number, wantE: number, alive: () => boolean) {
  let sh = 1;
  let sv = 1;
  for (let step = 0; step < 4 && alive(); step++) {
    await wait(120); // let a frame update the bridged camera
    const a = offAxis(p);
    if (!a) return;
    const dh = a.h - wantH;
    const de = a.e - wantE;
    if (Math.abs(dh) < 3 && Math.abs(de) < 4) return;
    try {
      await sdk.Camera.rotate(sh * dh, sv * Math.max(-60, Math.min(60, de)), { speed: 150 });
    } catch {
      /* at a vertical limit: still check the horizontal */
    }
    await wait(120);
    const b = offAxis(p);
    if (!b) return;
    if (Math.abs(b.h - wantH) > Math.abs(dh) + 2) sh = -sh;
    if (Math.abs(b.e - wantE) > Math.abs(de) + 2) sv = -sv;
  }
}
