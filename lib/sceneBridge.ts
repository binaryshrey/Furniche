'use client';
import * as THREE from 'three';
import { create } from 'zustand';
import type { Vec3 } from './types';
import { fromThree } from './coords';

// Shares the Matterport camera and our furniture group with DOM overlays that do their own raycasts.
// scan: Matterport's room-mesh chunks (found by SurfaceLayer), for snapping pieces to the real floor.
export const bridge: { camera: THREE.Camera | null; furniture: THREE.Group | null; scan: THREE.Mesh[] } = { camera: null, furniture: null, scan: [] };

type Ghost = { productId: string; pos: Vec3; rot: number } | null;

export const useGhost = create<{ ghost: Ghost; setGhost: (g: Ghost) => void }>((set) => ({
  ghost: null,
  setGhost: (ghost) => set({ ghost }),
}));

export const useViewerState = create<{
  sdk: any | null;
  ready: boolean;
  hasDefurnish: boolean;
  currentRoomId: string | null;
  cameraFloorZ: number;
  // True once Matterport is actually showing a room: inside mode, standing on a pano. `ready`
  // only means our boot code finished; a slow model can still be on its dark dollhouse view.
  showingRoom: boolean;
  scanVersion: number; // bumps when the scan's mesh chunks change, so floor snapping reruns
  embedOnly: boolean; // the SDK couldn't connect (key not enabled for this domain): plain embedded tour
  setPartial: (p: Partial<{ sdk: any; ready: boolean; hasDefurnish: boolean; currentRoomId: string | null; cameraFloorZ: number; showingRoom: boolean; scanVersion: number; embedOnly: boolean }>) => void;
}>((set) => ({
  sdk: null,
  ready: false,
  hasDefurnish: false,
  currentRoomId: null,
  cameraFloorZ: 0,
  showingRoom: false,
  scanVersion: 0,
  embedOnly: false,
  setPartial: (p) => set(p),
}));

const raycaster = new THREE.Raycaster();

export type Hit = { kind: 'item'; uid: string; point: Vec3 } | { kind: 'floor'; point: Vec3 } | null;

// ndc: normalized device coords. floorZ: API-frame floor height to intersect.
// Furniture answers only our own picking (below), never Matterport's pointer: otherwise a piece
// between the camera and a walking circle (or a piece's shadow round it) blocks the walk.
let picking = false;
export function pickOnly(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x.userData.__pickOnly) return;
    x.userData.__pickOnly = true;
    const own = x.raycast;
    x.raycast = function (r, hits) {
      if (picking) own.call(this, r, hits);
    };
  });
}

export function raycast(ndc: { x: number; y: number }, floorZ: number, itemsFirst = true): Hit {
  const cam = bridge.camera;
  if (!cam) return null;
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
  if (itemsFirst && bridge.furniture) {
    picking = true;
    let hits: THREE.Intersection[] = [];
    try {
      hits = raycaster.intersectObjects(bridge.furniture.children, true);
    } finally {
      picking = false;
    }
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData?.uid) o = o.parent;
      if (o?.userData?.uid && !o.userData.ghost) {
        return { kind: 'item', uid: o.userData.uid, point: fromThree(h.point.x, h.point.y, h.point.z) };
      }
    }
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorZ);
  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, p)) {
    // Ignore floor hits far from the camera (looking at the horizon).
    if (p.distanceTo(raycaster.ray.origin) > 40) return null;
    return { kind: 'floor', point: fromThree(p.x, p.y, p.z) };
  }
  return null;
}

// The first point of the scan itself under the cursor (a wall, the floor), in API coordinates.
export function scanPoint(ndc: { x: number; y: number }): Vec3 | null {
  const cam = bridge.camera;
  if (!cam || !bridge.scan.length) return null;
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
  raycaster.layers.enableAll();
  const h = raycaster.intersectObjects(bridge.scan, false)[0];
  return h && h.distance < 30 ? fromThree(h.point.x, h.point.y, h.point.z) : null;
}

const down = new THREE.Raycaster();
down.layers.enableAll(); // Matterport keeps its room mesh on its own render layer
const DOWN = new THREE.Vector3(0, -1, 0);

// Height of the scan's real floor at three.js (x, z), near an estimated height. The Model API
// floor heights are estimates (pano height minus a camera height), so flat things like rugs and
// shadows can end up a few cm under the real floor and get hidden. Hits more than 30 cm off the
// estimate (a leftover seller's table, a ceiling) are ignored.
export function groundY(x: number, z: number, approxY: number): number {
  if (!bridge.scan.length) return approxY;
  down.set(new THREE.Vector3(x, approxY + 1.2, z), DOWN);
  down.far = 2;
  let best: number | null = null;
  for (const h of down.intersectObjects(bridge.scan, false)) {
    if (Math.abs(h.point.y - approxY) > 0.3) continue;
    if (best === null || Math.abs(h.point.y - approxY) < Math.abs(best - approxY)) best = h.point.y;
  }
  return best ?? approxY;
}
