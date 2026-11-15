'use client';
import { toThree } from './coords';
import { centroid, pointInPolygon } from './geometry';
import type { ModelGeometry, Pano, PlacedItem, Product } from './types';

// After Auto-furnish: take the visitor to the best spot in the room, turn them toward the new
// furniture, then slowly look around once so they see the whole arrangement, ending on it.

type Sdk = any;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function currentPose(sdk: Sdk): Promise<{ position: { x: number; y: number; z: number }; rotation: { x: number; y: number } } | null> {
  return new Promise((resolve) => {
    let done = false;
    const sub = sdk.Camera.pose.subscribe((p: any) => {
      if (done) return;
      done = true;
      resolve(p);
      setTimeout(() => sub?.cancel?.(), 0);
    });
    setTimeout(() => !done && ((done = true), resolve(null)), 1500);
  });
}

// Yaw (degrees) that points the camera from `from` toward `to`, both in three.js coordinates.
// A three.js camera looks down -Z at yaw 0 and turns left as yaw grows.
export function yawToward(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return (Math.atan2(-(to.x - from.x), -(to.z - from.z)) * 180) / Math.PI;
}

// The pano in the room that sees the furniture best: inside the room, a few metres from the
// pieces (standing in the middle of them hides most of the layout).
export function viewpoint(room: { polygon: { x: number; y: number }[] }, panos: Pano[], target: { x: number; y: number }): Pano | null {
  const inside = panos.filter((p) => pointInPolygon(p.pos, room.polygon));
  if (!inside.length) return null;
  const score = (p: Pano) => {
    const d = Math.hypot(p.pos.x - target.x, p.pos.y - target.y);
    return -Math.abs(d - 2.6); // about 2.6 m back from the centre of the pieces
  };
  return [...inside].sort((a, b) => score(b) - score(a))[0];
}

let running = 0;

export async function showcaseRoom(opts: {
  sdk: Sdk;
  geometry: ModelGeometry;
  roomId: string;
  items: PlacedItem[];
  products: Map<string, Product>;
  moveToPano: (sdk: Sdk, panoId: string) => Promise<boolean>;
}): Promise<void> {
  const { sdk, geometry, roomId, items, moveToPano } = opts;
  const room = geometry.rooms.find((r) => r.id === roomId);
  if (!sdk || !room) return;
  const run = ++running;
  const mine = items.filter((i) => i.roomId === roomId);
  const target = mine.length ? centroid(mine.map((i) => ({ x: i.pos.x, y: i.pos.y }))) : centroid(room.polygon);

  const pano = viewpoint(room, geometry.panos, target);
  if (pano) {
    await moveToPano(sdk, pano.id);
    await wait(700);
  }
  if (run !== running) return;
  const pose = await currentPose(sdk);
  const [tx, , tz] = toThree({ x: target.x, y: target.y, z: room.floorZ });
  // The SDK pose can report a NaN position right after a move; the pano's own position is exact.
  const posed = pose?.position && Number.isFinite(pose.position.x) && Number.isFinite(pose.position.z) ? pose.position : null;
  const from = pano ? { x: toThree(pano.pos)[0], y: 0, z: toThree(pano.pos)[2] } : posed;
  if (!from) return;
  const yaw = yawToward({ x: from.x, z: from.z }, { x: tx, z: tz });
  try {
    await sdk.Camera.setRotation({ x: -18, y: yaw }, { speed: 80 }); // face the pieces, looking slightly down
    await wait(500);
    // One slow look around, in quarter turns so a click anywhere can interrupt between them.
    for (let q = 0; q < 4 && run === running; q++) await sdk.Camera.rotate(90, 0, { speed: 30 });
  } catch {
    /* the visitor took over the camera */
  }
}

// Stop a showcase in progress (the next camera step is skipped).
export function stopShowcase() {
  running++;
}
