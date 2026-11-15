import { describe, expect, it } from 'vitest';
import { viewpoint, yawToward } from './showcase';
import type { Pano } from './types';

describe('yawToward (Matterport yaw, clockwise from -Z)', () => {
  it('points at targets in each direction', () => {
    expect(yawToward({ x: 0, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(0); // straight ahead
    expect(yawToward({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(90); // right
    expect(yawToward({ x: 0, z: 0 }, { x: -1, z: 0 })).toBeCloseTo(-90); // left
    expect(Math.abs(yawToward({ x: 0, z: 0 }, { x: 0, z: 1 }))).toBeCloseTo(180); // behind
  });
});

describe('viewpoint', () => {
  const room = { polygon: [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }] };
  const pano = (id: string, x: number, y: number): Pano => ({ id, label: '', floorId: 'f', pos: { x, y, z: 1.5 } });

  it('stands back from the pieces, inside the room, away from walls', () => {
    const panos = [pano('on-top', 3, 2.5), pano('wall', 0.2, 2.5), pano('good', 3, 4.2), pano('outside', 9, 9)];
    expect(viewpoint(room, panos, { x: 3, y: 1 })?.id).toBe('good');
  });
});
