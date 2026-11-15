import { describe, expect, it } from 'vitest';
import { closetOpenings } from './closets';
import type { Room } from './types';

const rect = (id: string, label: string, x0: number, y0: number, x1: number, y1: number): Room => ({
  id, label, floorId: 'f', polygon: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  areaM2: (x1 - x0) * (y1 - y0), widthM: x1 - x0, depthM: y1 - y0, heightM: 2.5, floorZ: 0,
});

describe('closetOpenings', () => {
  const bedroom = rect('bed', 'Bedroom', 0, 0, 4, 3.5);
  it('finds a closet sharing a wall and returns its door in the middle of the shared stretch', () => {
    const closet = rect('c', 'Closet', 4.15, 1, 5, 2.4); // 15 cm of wall between the outlines
    const d = closetOpenings(bedroom, [bedroom, closet]);
    expect(d).toHaveLength(1);
    expect(d[0].roomId).toBe('bed');
    expect(d[0].pos.x).toBeCloseTo(4, 1);
    expect(d[0].pos.y).toBeCloseTo(1.7, 1);
    expect(d[0].widthM).toBeCloseTo(1.4, 1);
  });
  it('ignores rooms that are not closets, far-away closets and other floors', () => {
    expect(closetOpenings(bedroom, [bedroom, rect('h', 'Hallway', 4.15, 1, 5, 2.4)])).toEqual([]);
    expect(closetOpenings(bedroom, [bedroom, rect('c', 'Closet', 6, 1, 7, 2)])).toEqual([]);
    expect(closetOpenings(bedroom, [bedroom, { ...rect('c', 'Closet', 4.15, 1, 5, 2.4), floorId: 'g' }])).toEqual([]);
  });
  it('also treats a pantry or laundry room as a door to keep clear', () => {
    expect(closetOpenings(bedroom, [bedroom, rect('p', 'Pantry', -0.8, 1, -0.15, 2)])).toHaveLength(1);
    expect(closetOpenings(bedroom, [bedroom, rect('l', 'Laundry', 1, 3.6, 2.5, 4.5)])).toHaveLength(1);
  });
});

import { isInteriorWall } from './closets';

describe('isInteriorWall', () => {
  const living = rect('l', 'Living Room', 0, 0, 5, 4);
  const hall = rect('h', 'Hallway', 5.15, 0, 6.2, 4); // shares the east wall
  it('treats a wall another room shares as interior and the rest as exterior', () => {
    const rooms = [living, hall];
    expect(isInteriorWall({ x: 5, y: 0 }, { x: 5, y: 4 }, living, rooms)).toBe(true); // east: the hallway
    expect(isInteriorWall({ x: 0, y: 0 }, { x: 5, y: 0 }, living, rooms)).toBe(false); // south: outside
    expect(isInteriorWall({ x: 0, y: 4 }, { x: 0, y: 0 }, living, rooms)).toBe(false); // west: outside
  });
  it('needs a real shared stretch, not a corner touching', () => {
    expect(isInteriorWall({ x: 5, y: 0 }, { x: 5, y: 4 }, living, [living, rect('s', 'Hallway', 5.15, 3.7, 6, 5)])).toBe(false);
  });
});

import { linkDoors } from './closets';

describe('linkDoors', () => {
  const a = rect('a', 'Bedroom', 0, 0, 4, 3);
  const b = rect('b', 'Hallway', 4.15, 0, 6, 3);
  const pano = (id: string, x: number, y: number) => ({ id, label: id, floorId: 'f', pos: { x, y, z: 1.4 } });
  const panos = [pano('p1', 3, 1.5), pano('p2', 5, 1.5), pano('p3', 3, 0.4), pano('p4', 5, 0.4)];

  it('puts a door where a sightline between two rooms leaves this one', () => {
    const d = linkDoors(a, [a, b], panos, [['p1', 'p2']]);
    expect(d).toHaveLength(1);
    expect(d[0].roomId).toBe('a');
    expect(d[0].pos.x).toBeCloseTo(4, 1);
    expect(d[0].pos.y).toBeCloseTo(1.5, 1);
    expect(d[0].widthM).toBeCloseTo(0.9, 1);
  });
  it('is the same from the other room, ignores links inside one room and merges close crossings', () => {
    expect(linkDoors(b, [a, b], panos, [['p1', 'p2']])).toHaveLength(1);
    expect(linkDoors(a, [a, b], panos, [['p1', 'p3']])).toEqual([]);
    expect(linkDoors(a, [a, b], panos, [['p1', 'p2'], ['p1', 'p2']])).toHaveLength(1);
    expect(linkDoors(a, [a, b], panos, [['p3', 'p4'], ['p1', 'p2']]).length).toBe(2); // two separate doorways, 1.1 m apart
  });
});
