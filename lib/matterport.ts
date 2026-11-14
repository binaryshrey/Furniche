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

  // The pano API has no floor field. Each floor shows up as a dense cluster of camera
  // heights (the camera sits ~1.5 m above the floor); panos on a staircase are stragglers in
  // between, so look for clusters rather than gaps. The largest clusters, one per floor, are
  // the floors, listed bottom to top.
  const CAMERA_HEIGHT = 1.5;
  const rawFloors: any[] = m.floors ?? [];
  const sortedZ = panos.map((p) => p.pos.z).sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const z of sortedZ) {
    const last = clusters[clusters.length - 1];
    if (last && z - last[last.length - 1] < 0.35) last.push(z);
    else clusters.push([z]);
  }
  const levels = clusters
    .sort((a, b) => b.length - a.length)
    .slice(0, Math.max(1, rawFloors.length))
    .map((c) => c[Math.floor(c.length / 2)])
    .sort((a, b) => a - b);
  const floors: Floor[] = rawFloors.map((f: any, i: number) => ({
    id: f.id,
    label: f.label ?? '',
    z: (levels[i] ?? (levels[levels.length - 1] ?? CAMERA_HEIGHT) + 3 * (i - levels.length + 1)) - CAMERA_HEIGHT,
  }));
  const floorIndex = (z: number) =>
    levels.reduce((best, lv, i) => (Math.abs(z - lv) < Math.abs(z - levels[best]) ? i : best), 0);
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
      // Some rooms come back without dimensions; fall back to the outline's bounding box.
      areaM2: dims.areaFloor || polygonArea(polygon),
      widthM: dims.width || Math.max(...polygon.map((v) => v.x)) - Math.min(...polygon.map((v) => v.x)),
      depthM: dims.depth || Math.max(...polygon.map((v) => v.y)) - Math.min(...polygon.map((v) => v.y)),
      heightM: dims.height || null,
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

// The six cube faces of a panorama (Matterport order: up, then four sides, then down), at the
// best resolution available. The URLs are signed and expire, so they are fetched fresh.
const RES_ORDER = ['2k', 'high', 'low'];
export async function panoSkybox(sid: string, panoId: string): Promise<string[] | null> {
  const data = await gql<{ model: { panoLocations: { id: string; skyboxes: { resolution: string; status: string; children: string[] }[] }[] } }>(
    `query($id: ID!) { model(id: $id) { panoLocations { id skyboxes { resolution status children } } } }`,
    { id: sid },
  );
  const pano = data.model?.panoLocations.find((p) => p.id === panoId);
  const boxes = (pano?.skyboxes ?? []).filter((b) => b.status === 'available' && b.children?.length === 6);
  boxes.sort((a, b) => (RES_ORDER.indexOf(a.resolution) + 99) % 99 - (RES_ORDER.indexOf(b.resolution) + 99) % 99);
  return boxes[0]?.children ?? null;
}
