import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Listing, Vec2 } from './types';
import { cacheDir } from '@/lib/cacheDir';

const BASE = 'https://api.vexcelgroup.com/v2';

// Local frame for the outdoor planner: metres, x east, y north, origin at the image centre.
// At parcel scale an equirectangular projection is accurate to a few centimetres.
export type Property = {
  listingId: string;
  address: string;
  center: { lat: number; lon: number };
  sizeM: number; // the aerial image covers sizeM × sizeM, north up
  parcel: Vec2[];
  buildings: Vec2[][];
  pool: boolean;
  hardscapeM2: number | null;
  deckM2: number | null;
  treeCoverPct: number | null;
  imageDate: string | null;
};

function apiKey(): string {
  const key = process.env.VEXCEL_API_KEY;
  if (!key) throw new Error('VEXCEL_API_KEY must be set in .env.local');
  return key;
}

export async function homeListing(listingId: string): Promise<Extract<Listing, { kind: 'home' }> | null> {
  const raw = await readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8');
  const homes = JSON.parse(raw).homes as Extract<Listing, { kind: 'home' }>[];
  return homes.find((h) => String(h.listingId) === listingId) ?? null;
}

// Outer rings of a WKT POLYGON or MULTIPOLYGON as [lon, lat] pairs.
function wktRings(wkt: string): [number, number][][] {
  return [...wkt.matchAll(/\(\(([^()]+)\)/g)].map((m) =>
    m[1].split(',').map((pair) => pair.trim().split(/\s+/).map(Number) as [number, number]),
  );
}

const project = (lon: number, lat: number, c: { lat: number; lon: number }): Vec2 => ({
  x: (lon - c.lon) * 111_320 * Math.cos((c.lat * Math.PI) / 180),
  y: (lat - c.lat) * 110_574,
});

const cache = new Map<string, { at: number; value: Property }>();

export async function getProperty(listingId: string): Promise<Property> {
  const hit = cache.get(listingId);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;

  const home = await homeListing(listingId);
  if (!home) throw new Error('No home listing with that id');
  if (home.lat == null || home.lon == null) throw new Error('This listing has no coordinates');

  const res = await fetch(`${BASE}/property/extract?wkt=POINT(${home.lon} ${home.lat})&srid=4326`, {
    headers: { 'X-API-KEY': apiKey() },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Vexcel property API ${res.status}`);
  const feature = (await res.json()).features?.[0];
  if (!feature) throw new Error('Vexcel has no parcel for this address');
  const props = feature.properties;

  const parcelLonLat: [number, number][] = feature.geometry.coordinates[0][0];
  const lons = parcelLonLat.map((p) => p[0]);
  const lats = parcelLonLat.map((p) => p[1]);
  const center = { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
  const parcel = parcelLonLat.map(([lon, lat]) => project(lon, lat, center));
  const extent = Math.max(...parcel.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  // Square frame with a margin so neighbours give context; capped so the image stays sharp.
  const sizeM = Math.min(120, Math.max(30, Math.ceil(extent * 2 + 12)));

  // Vexcel returns attributes as flat dotted keys, e.g. 'footprint.wkt', 'pool.detected'.
  const buildings = (props.structures ?? []).flatMap((s: Record<string, any>) =>
    s['footprint.wkt'] ? wktRings(s['footprint.wkt']).map((ring) => ring.map(([lon, lat]) => project(lon, lat, center))) : [],
  );

  const value: Property = {
    listingId,
    address: home.address,
    center,
    sizeM,
    parcel,
    buildings,
    pool: !!props['pool.detected'],
    hardscapeM2: props['hardscapes.area'] ?? null,
    deckM2: props['deck.area'] ?? null,
    treeCoverPct: props['parcel-tree-cover.percent'] ?? null,
    imageDate: props['metadata.ortho-date-estimate'] ?? null,
  };
  cache.set(listingId, { at: Date.now(), value });
  return value;
}

export async function getOrtho(p: Property): Promise<ArrayBuffer> {
  const q = new URLSearchParams({
    layer: 'urban',
    wkt: `POINT(${p.center.lon} ${p.center.lat})`,
    srid: '4326',
    'bbox-dimensions': `${p.sizeM},${p.sizeM}`,
    'destination-dimensions': '1024,1024',
    'image-format': 'jpeg',
  });
  const res = await fetch(`${BASE}/ortho/extract?${q}`, { headers: { 'X-API-KEY': apiKey() }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Vexcel ortho API ${res.status}`);
  return res.arrayBuffer();
}

// Web-mercator XYZ ortho tiles (256 px) for the search map. Panning refetches the same tiles,
// so keep a small in-memory cache in front of the API.
const tiles = new Map<string, ArrayBuffer | null>();

export async function getTile(z: number, x: number, y: number): Promise<ArrayBuffer | null> {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) return tiles.get(key)!;
  const q = new URLSearchParams({ layer: 'urban', zoom: String(z), 'tile-x': String(x), 'tile-y': String(y), 'no-content': '204' });
  const res = await fetch(`${BASE}/ortho/tile?${q}`, { headers: { 'X-API-KEY': apiKey() }, cache: 'no-store' });
  if (!res.ok && res.status !== 204) throw new Error(`Vexcel tile API ${res.status}`);
  const img = res.status === 204 ? null : await res.arrayBuffer();
  if (tiles.size > 2000) tiles.delete(tiles.keys().next().value!);
  tiles.set(key, img);
  return img;
}

// 3D Tiles (glTF city mesh). Only Houston has a 3D collection on this key.
export const CITY_3D = { collection: 'us-tx-houstonr2-2023', layer: '3d-cities' };
const TILE_3D_PARAMS = new Set(['zoom', 'tile-x', 'tile-y', 'childAOI', 'collection', 'layer', 'latest']);

// The 3D collection is fixed, so every tileset and mesh is cached on disk forever: the first
// visit pays Vexcel's ~200 ms per request, later visits read from .cache/tiles3d.
const TILES_3D_CACHE = cacheDir('tiles3d');

export async function get3d(kind: 'tileset' | 'tile', params: URLSearchParams): Promise<Buffer | null> {
  const q = new URLSearchParams();
  params.forEach((v, k) => {
    if (TILE_3D_PARAMS.has(k)) q.append(k, v);
  });
  q.sort();
  const file = path.join(TILES_3D_CACHE, `${kind}-${createHash('sha1').update(q.toString()).digest('hex')}`);
  try {
    return await readFile(file);
  } catch {
    /* not cached yet */
  }
  const res = await fetch(`${BASE}/3d/${kind}?${q}`, { headers: { 'X-API-KEY': apiKey() }, cache: 'no-store' });
  if (!res.ok) return null;
  const body = Buffer.from(await res.arrayBuffer());
  await mkdir(TILES_3D_CACHE, { recursive: true });
  await writeFile(file, body);
  return body;
}

// 3d-tiles-renderer picks a parser from the file extension and Vexcel's links have none
// (./tileset?…, ./tile?…), so tilesets are served with ./tileset.json?… and ./tile.glb?… links.
export function rewriteTileset(json: string): string {
  return json.replace(/"\.\/tileset\?/g, '"./tileset.json?').replace(/"\.\/tile\?/g, '"./tile.glb?');
}

export const CITY_3D_ROOT = 'tileset.json?collection=us-tx-houstonr2-2023&layer=3d-cities';

// Every tileset and mesh URL of the city down to `maxZoom`, exactly as the renderer will request
// them (relative to /api/vexcel/3d/). Crawled once from the (disk-cached) tilesets, then saved.
export async function city3dManifest(maxZoom = 15): Promise<string[]> {
  const file = path.join(TILES_3D_CACHE, `manifest-z${maxZoom}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    /* crawl below */
  }
  const zoomOf = (u: string) => Number(u.match(/zoom=(\d+)/)?.[1] ?? 0);
  const urls: string[] = [CITY_3D_ROOT];
  const seen = new Set(urls);
  let frontier = [CITY_3D_ROOT];
  while (frontier.length) {
    const next: string[] = [];
    // A few at a time: the first crawl goes to Vexcel.
    for (let i = 0; i < frontier.length; i += 12) {
      const bodies = await Promise.all(
        frontier.slice(i, i + 12).map(async (u) => {
          const q = new URLSearchParams(u.slice(u.indexOf('?') + 1));
          return get3d('tileset', q);
        }),
      );
      for (const body of bodies) {
        if (!body) continue;
        for (const m of rewriteTileset(body.toString('utf8')).matchAll(/"uri"\s*:\s*"\.\/([^"]+)"/g)) {
          const u = m[1];
          if (seen.has(u) || zoomOf(u) > maxZoom) continue;
          seen.add(u);
          urls.push(u);
          if (u.startsWith('tileset.json')) next.push(u);
        }
      }
    }
    frontier = next;
  }
  await mkdir(TILES_3D_CACHE, { recursive: true });
  await writeFile(file, JSON.stringify(urls));
  return urls;
}
