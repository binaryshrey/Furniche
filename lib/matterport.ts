import 'server-only';
import { chainPolygon, polygonArea } from './geometry';
import type { Floor, ModelGeometry, Pano, Room, Vec2, Wall } from './types';

const ENDPOINT = 'https://api.matterport.com/api/models/graph';

function authHeader(): string {
  const key = process.env.MATTERPORT_API_KEY;
  const token = process.env.MATTERPORT_API_TOKEN;
  if (!key || !token) throw new Error('MATTERPORT_API_KEY and MATTERPORT_API_TOKEN must be set in .env.local');
  return 'Basic ' + Buffer.from(`${key}:${token}`).toString('base64');
}

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Matterport API ${res.status}`);
  const json = await res.json();
  if (json.errors?.length && !json.data) throw new Error(json.errors[0].message);
  return json.data as T;
}

const GEOMETRY_QUERY = `query($id: ID!) {
  model(id: $id) {
    id name
    address { address }
    geolocation { lat long }
    views { id type }
    floors { id label vertices { id position { x y } } edges { id type thickness vertices { id } } }
    rooms {
      id floor { id }
      classifications { label }
      dimensions(units: metric) { areaFloor width depth height }
      dimensionEstimates { lowerElevation units }
      boundary { edges { id } }
    }
    panoLocations { id label position { x y z } }
  }
}`;

const cache = new Map<string, { at: number; data: ModelGeometry }>();
const TTL_MS = 10 * 60 * 1000;

export async function getModelGeometry(sid: string): Promise<ModelGeometry> {
  const hit = cache.get(sid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const data = await gql<{ model: any }>(GEOMETRY_QUERY, { id: sid });
  const m = data.model;
  if (!m) throw new Error('Model not found');

  const panos: Pano[] = (m.panoLocations ?? []).map((p: any) => ({
    id: p.id,
    label: p.label ?? '',
    floorId: null,
    pos: { x: p.position.x, y: p.position.y, z: p.position.z },
  }));

  // The pano API has no floor field. Split pano heights at the largest gaps into one
  // group per floor (floors are listed bottom to top). The camera sits ~1.5 m above the floor.
  const CAMERA_HEIGHT = 1.5;
  const rawFloors: any[] = m.floors ?? [];
  const sortedZ = panos.map((p) => p.pos.z).sort((a, b) => a - b);
  const cuts = sortedZ
    .slice(1)
    .map((z, i) => ({ gap: z - sortedZ[i], at: (z + sortedZ[i]) / 2 }))
    .filter((g) => g.gap > 1.8)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, Math.max(0, rawFloors.length - 1))
    .map((g) => g.at)
    .sort((a, b) => a - b);
  const floorIndex = (z: number) => cuts.filter((c) => z > c).length;
  const floors: Floor[] = rawFloors.map((f: any, i: number) => {
    const zs = sortedZ.filter((z) => floorIndex(z) === i);
    const median = zs.length ? zs[Math.floor(zs.length / 2)] : CAMERA_HEIGHT + i * 3;
    return { id: f.id, label: f.label ?? '', z: median - CAMERA_HEIGHT };
  });
  for (const p of panos) p.floorId = floors[Math.min(floorIndex(p.pos.z), floors.length - 1)]?.id ?? null;
  const floorZ = new Map(floors.map((f) => [f.id, f.z]));

  const walls: Record<string, Wall[]> = {};
  const edgeVerts = new Map<string, [string, string]>();
  const verts: Record<string, Vec2> = {};
  for (const f of m.floors ?? []) {
    const vmap: Record<string, Vec2> = {};
    for (const v of f.vertices ?? []) {
      vmap[v.id] = { x: v.position.x, y: v.position.y };
      verts[v.id] = vmap[v.id];
    }
    walls[f.id] = [];
    for (const e of f.edges ?? []) {
      const [a, b] = (e.vertices ?? []).map((v: any) => v.id);
      if (!a || !b || !vmap[a] || !vmap[b]) continue;
      edgeVerts.set(e.id, [a, b]);
      walls[f.id].push({ id: e.id, a: vmap[a], b: vmap[b], thickness: e.thickness ?? 0.1 });
    }
  }

  const rooms: Room[] = [];
  for (const r of m.rooms ?? []) {
    const label = r.classifications?.[0]?.label ?? 'Room';
    if (label === 'Void') continue;
    const edges = (r.boundary?.edges ?? [])
      .map((e: any) => edgeVerts.get(e.id))
      .filter(Boolean) as [string, string][];
    const polygon = chainPolygon(edges, verts);
    if (!polygon) continue;
    const dims = r.dimensions ?? {};
    const fid = r.floor?.id ?? floors[0]?.id ?? '';
    rooms.push({
      id: r.id,
      label,
      floorId: fid,
      polygon,
      areaM2: dims.areaFloor ?? polygonArea(polygon),
      widthM: dims.width ?? 0,
      depthM: dims.depth ?? 0,
      heightM: dims.height ?? null,
      floorZ: floorZ.get(fid) ?? 0,
    });
  }

  const geometry: ModelGeometry = {
    sid,
    name: m.name ?? sid,
    address: m.address?.address ?? null,
    lat: m.geolocation?.lat != null ? Number(m.geolocation.lat) : null,
    lon: m.geolocation?.long != null ? Number(m.geolocation.long) : null,
    defurnishedViewId: (m.views ?? []).find((v: any) => v.type === 'matterport.model.defurnished')?.id ?? null,
    floors,
    walls,
    rooms,
    panos,
  };
  cache.set(sid, { at: Date.now(), data: geometry });
  return geometry;
}
