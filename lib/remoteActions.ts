'use client';
import * as THREE from 'three';
import { toThree } from './coords';
import { bridge, useViewerState } from './sceneBridge';
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

// Walk to the nearest viewpoint ahead of (or behind) the camera, like pressing the arrow keys.
export async function step(sdk: Sdk, geometry: ModelGeometry | null, dir: 'forward' | 'back', moveToPano: (sdk: Sdk, id: string) => Promise<boolean>) {
  const cam = bridge.camera;
  const f = forward();
  if (!sdk || !geometry || !cam || !f) return false;
  const ahead = new THREE.Vector2(f.x, f.z).normalize().multiplyScalar(dir === 'forward' ? 1 : -1);
  const here = new THREE.Vector2(cam.position.x, cam.position.z);
  const floorZ = useViewerState.getState().cameraFloorZ;
  let best: { id: string; score: number } | null = null;
  for (const p of geometry.panos) {
    if (Math.abs(p.pos.z - 1.5 - floorZ) > 1.2) continue; // same floor
    const [x, , z] = toThree(p.pos);
    const v = new THREE.Vector2(x, z).sub(here);
    const d = v.length();
    if (d < 0.6 || d > 5) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, v.normalize().dot(ahead))));
    if (angle > (40 * Math.PI) / 180) continue;
    const score = d * (1 + angle * 1.5);
    if (!best || score < best.score) best = { id: p.id, score };
  }
  return best ? moveToPano(sdk, best.id) : false;
}
