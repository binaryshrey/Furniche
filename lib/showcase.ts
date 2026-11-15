'use client';
import { toThree } from './coords';
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
  const inside = panos.filter((p) => pointInPolygon(p.pos, room.polygon));
  if (!inside.length) return null;
  // Close to the wanted distance, and never right on top of the pieces.
  const score = (p: Pano) => {
    const d = Math.hypot(p.pos.x - target.x, p.pos.y - target.y);
    const wall = minDistToBoundary([p.pos], room.polygon); // a pano pressed against a wall frames badly
    return -Math.abs(d - back) - (d < 1.5 ? 10 : 0) - (wall < 0.7 ? 3 : 0);
  };
  return [...inside].sort((a, b) => score(b) - score(a))[0];
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
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) finish({ sid: sw.sid, x: p.x, z: p.z });
      setTimeout(() => sub?.cancel?.(), 0);
    });
    setTimeout(() => finish(null), 1500);
  });
}

export async function lookAt(opts: {
  sdk: Sdk;
  geometry: ModelGeometry;
  roomId: string;
  target?: Vec2; // defaults to the middle of the room's furniture
  items?: PlacedItem[];
  back?: number;
  yawOffset?: number; // degrees clockwise; positive turns right, putting the target left of centre
  moveToPano: (sdk: Sdk, panoId: string) => Promise<boolean>;
}): Promise<void> {
  const { sdk, geometry, roomId, moveToPano } = opts;
  const room = geometry.rooms.find((r) => r.id === roomId);
  if (!sdk || !room) return;
  const run = ++running;
  const mine = (opts.items ?? []).filter((i) => i.roomId === roomId);
  const target = opts.target ?? (mine.length ? centroid(mine.map((i) => ({ x: i.pos.x, y: i.pos.y }))) : centroid(room.polygon));

  const pano = viewpoint(room, geometry.panos, target, opts.back);
  if (!pano) return;
  await moveToPano(sdk, pano.id);
  await wait(600);
  if (run !== running) return;
  // Aim from where the camera really is (a move can land on a neighbouring sweep), else the pano.
  const at = await currentSweep(sdk);
  const [ppx, , ppz] = toThree(pano.pos);
  const [px, pz] = at ? [at.x, at.z] : [ppx, ppz];
  const [tx, , tz] = toThree({ x: target.x, y: target.y, z: room.floorZ });
  try {
    await sdk.Camera.setRotation({ x: -18, y: yawToward({ x: px, z: pz }, { x: tx, z: tz }) + (opts.yawOffset ?? 0) }, { speed: 90 }); // slightly down, at the pieces
  } catch {
    /* the visitor took over the camera */
  }
}
