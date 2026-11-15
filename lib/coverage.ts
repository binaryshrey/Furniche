'use client';
import { useCallback, useEffect, useState } from 'react';
import { tileKey } from './meshTile';

// Vexcel's Houston 3D collection (us-tx-houstonr2-2023) spans 29.47–29.83 N, 95.99–95.32 W. Pins
// stay ~2 km inside it so a home never sits at the ragged edge of the mesh.
export const COVERAGE = { south: 29.49, north: 29.81, west: -95.97, east: -95.34 };
export const inCoverage = (r: { lat: number; lon: number }) =>
  r.lat > COVERAGE.south && r.lat < COVERAGE.north && r.lon > COVERAGE.west && r.lon < COVERAGE.east;

// The box has gaps with no mesh, so the precise test is whether the home's zoom-15 map tile
// holds a mesh tile (from /api/vexcel/3d-coverage). Until that arrives, the box is used.
let meshTiles: Promise<Set<string> | null> | null = null;
const loadMesh = () =>
  (meshTiles ??= fetch('/api/vexcel/3d-coverage')
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { tiles: [number, number][] } | null) => (d ? new Set(d.tiles.map(([x, y]) => `${x},${y}`)) : null))
    .catch(() => null));

export function useOnMesh(): (r: { lat: number; lon: number }) => boolean {
  const [tiles, setTiles] = useState<Set<string> | null>(null);
  useEffect(() => {
    let live = true;
    loadMesh().then((t) => live && setTiles(t));
    return () => {
      live = false;
    };
  }, []);
  // Once the tile list is in, it alone decides (the box is only a stand-in and would hide homes
  // that sit on the mesh a little outside it).
  return useCallback((r) => (tiles ? tiles.has(tileKey(r.lat, r.lon, 15)) : inCoverage(r)), [tiles]);
}
