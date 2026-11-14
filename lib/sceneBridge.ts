'use client';
import * as THREE from 'three';
import { create } from 'zustand';
import type { Vec3 } from './types';
import { fromThree } from './coords';

// Shares the Matterport camera and our furniture group with DOM overlays that do their own raycasts.
export const bridge: { camera: THREE.Camera | null; furniture: THREE.Group | null } = { camera: null, furniture: null };

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
  setPartial: (p: Partial<{ sdk: any; ready: boolean; hasDefurnish: boolean; currentRoomId: string | null; cameraFloorZ: number }>) => void;
}>((set) => ({
  sdk: null,
  ready: false,
  hasDefurnish: false,
  currentRoomId: null,
  cameraFloorZ: 0,
  setPartial: (p) => set(p),
}));

const raycaster = new THREE.Raycaster();

export type Hit = { kind: 'item'; uid: string; point: Vec3 } | { kind: 'floor'; point: Vec3 } | null;

// ndc: normalized device coords. floorZ: API-frame floor height to intersect.
export function raycast(ndc: { x: number; y: number }, floorZ: number, itemsFirst = true): Hit {
  const cam = bridge.camera;
  if (!cam) return null;
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
  if (itemsFirst && bridge.furniture) {
    const hits = raycaster.intersectObjects(bridge.furniture.children, true);
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
