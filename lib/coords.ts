import type { Vec3 } from './types';

// Matterport Model API: metres, Z up. three.js / Showcase SDK: metres, Y up.
// Verified 2026-11-14 on model zvKHR9DHNjJ: sdk = (api.x, api.z, -api.y).

export function toThree(p: Vec3): [number, number, number] {
  return [p.x, p.z, -p.y];
}

export function fromThree(x: number, y: number, z: number): Vec3 {
  return { x, y: -z, z: y };
}

// A rotation of `rot` radians about the API's Z axis is a rotation about three.js Y.
export function rotToThree(rot: number): number {
  return rot;
}
