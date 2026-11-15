'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { materialById } from '@/catalog/materials';
import { centroid } from '@/lib/geometry';
import { bridge, groundY, useViewerState } from '@/lib/sceneBridge';
import { useDesign } from '@/lib/store';
import type { ModelGeometry, SurfaceChoice } from '@/lib/types';

// Paint, wallpaper and flooring drawn onto the scan's own mesh. Matterport renders the
// panorama on chunked "RoomMesh" geometry; we draw a second, depth-biased copy of those chunks
// with a shader that keeps only the fragments belonging to the chosen surface:
//   walls: vertical faces near the room outline whose normal points into the room
//   floor: upward faces at floor height inside the room outline
// Open doorways have no mesh, so they stay clear, and real walls hide paint behind them.

const MAX_VERTS = 48;
const ALL_ROOMS = 32;
const ALL_VERTS = 480;

const vertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const fragment = /* glsl */ `
  uniform vec2 uPoly[${MAX_VERTS}];
  uniform int uCount;
  uniform float uFloor;
  uniform float uHeight;
  uniform int uMode;      // 0 walls, 1 floor
  uniform int uPattern;   // 0 solid, 1 wallpaper stripes, 2 planks
  uniform vec4 uSeg;      // one wall only (x0, y0, x1, y1) when uUseSeg == 1
  uniform int uUseSeg;
  uniform vec3 uColor;
  uniform vec3 uAccent;
  uniform float uAlpha;
  uniform vec2 uAll[${ALL_VERTS}];   // every room's outline, one after another (mode 2)
  uniform int uStart[${ALL_ROOMS}];
  uniform int uLen[${ALL_ROOMS}];
  uniform float uFY[${ALL_ROOMS}];   // each room's real floor height (three.js y)
  uniform int uRooms;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  bool insidePoly(vec2 q) {
    bool c = false;
    for (int i = 0; i < ${MAX_VERTS}; i++) {
      if (i >= uCount) break;
      int j = i == 0 ? uCount - 1 : i - 1;
      vec2 a = uPoly[i];
      vec2 b = uPoly[j];
      if (((a.y > q.y) != (b.y > q.y)) && (q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y + 1e-9) + a.x)) c = !c;
    }
    return c;
  }

  float segDist(vec2 q, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float t = clamp(dot(q - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
    return length(q - (a + t * ab));
  }

  float edgeDist(vec2 q) {
    if (uUseSeg == 1) return segDist(q, uSeg.xy, uSeg.zw);
    float d = 1e9;
    for (int i = 0; i < ${MAX_VERTS}; i++) {
      if (i >= uCount) break;
      int j = i == 0 ? uCount - 1 : i - 1;
      d = min(d, segDist(q, uPoly[i], uPoly[j]));
    }
    return d;
  }

  // On the floor of some room: inside its outline, or within a doorway's depth of it (thresholds
  // between rooms), at that room's floor height.
  bool onAnyFloor(vec2 q, float y) {
    for (int r = 0; r < ${ALL_ROOMS}; r++) {
      if (r >= uRooms) break;
      if (abs(y - uFY[r]) > 0.09) continue;
      int s0 = uStart[r];
      int n = uLen[r];
      bool c = false;
      float d = 1e9;
      for (int k = 0; k < ${ALL_VERTS}; k++) {
        if (k >= n) break;
        vec2 a = uAll[s0 + k];
        vec2 b = uAll[s0 + (k == 0 ? n - 1 : k - 1)];
        if (((a.y > q.y) != (b.y > q.y)) && (q.x < (b.x - a.x) * (q.y - a.y) / (b.y - a.y + 1e-9) + a.x)) c = !c;
        d = min(d, segDist(q, a, b));
      }
      if (c || d < 0.2) return true;
    }
    return false;
  }

  void main() {
    vec3 p = vWorld;
    vec2 q = vec2(p.x, -p.z);                       // three -> Matterport API floor plane
    vec3 n = normalize(cross(dFdx(p), dFdy(p)));
    if (dot(n, cameraPosition - p) < 0.0) n = -n;   // face the camera
    vec2 nq = vec2(n.x, -n.z);
    vec3 col = uColor;

    if (uMode == 0) {
      if (abs(n.y) > 0.35) discard;
      if (p.y < uFloor + 0.04 || p.y > uFloor + uHeight - 0.03) discard;
      // Wall faces sit about half a wall's thickness from the outline (which runs mid-wall);
      // blinds, shelves and cabinets stand further out and stay unpainted.
      if (edgeDist(q) > 0.17) discard;
      if (!insidePoly(q + normalize(nq + 1e-6) * 0.3)) discard;   // this room's side of the wall
      if (uPattern == 1) {
        vec2 t = normalize(vec2(-nq.y, nq.x) + 1e-6);
        float u = dot(q, t);
        col = mix(uColor, uAccent, step(0.8, fract(u / 0.13)));
      }
    } else {
      if (n.y < 0.85) discard;
      if (uMode == 2) {
        if (!onAnyFloor(q, p.y)) discard;
      } else {
        if (abs(p.y - uFloor) > 0.12) discard;
        if (!insidePoly(q)) discard;
      }
      if (uPattern == 2) {
        float boardW = 0.19, boardL = 1.25;
        float row = floor(q.y / boardW);
        float x = q.x + hash(vec2(row, 1.0)) * boardL;
        float seg = floor(x / boardL);
        float tone = 0.9 + 0.2 * hash(vec2(row, seg));
        float gap = step(fract(q.y / boardW), 0.035) + step(fract(x / boardL), 0.008);
        col = uColor * tone * (1.0 - 0.35 * clamp(gap, 0.0, 1.0));
      }
    }
    gl_FragColor = vec4(col, uAlpha);
  }
`;

type Chunk = THREE.Mesh;

// Depth only, nudged slightly back so furniture resting on the floor or against a wall isn't clipped.
const OCCLUDER = new THREE.MeshBasicMaterial({
  colorWrite: false,
  depthWrite: true,
  depthTest: true,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 2,
  polygonOffsetUnits: 2,
});

function findChunks(root: THREE.Object3D): Chunk[] {
  const out: Chunk[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name.startsWith('RoomMesh')) out.push(o as Chunk);
  });
  return out;
}

function shownInTree(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

// Rooms whose floor the home's flooring covers (not the garage or outdoor spaces), with the
// scan's real floor height for each.
const NOT_FLOORED = /garage|patio|porch|deck|balcony|yard|void|exterior|outdoor/i;
function allFloors(geometry: ModelGeometry) {
  const rooms = geometry.rooms.filter((r) => !NOT_FLOORED.test(r.label) && r.polygon.length >= 3).slice(0, ALL_ROOMS);
  const pts: THREE.Vector2[] = [];
  const start: number[] = [];
  const len: number[] = [];
  const fy: number[] = [];
  for (const r of rooms) {
    if (pts.length + r.polygon.length > ALL_VERTS) break;
    start.push(pts.length);
    len.push(r.polygon.length);
    for (const v of r.polygon) pts.push(new THREE.Vector2(v.x, v.y));
    const c = centroid(r.polygon);
    fy.push(groundY(c.x, -c.y, r.floorZ));
  }
  const n = start.length;
  while (pts.length < ALL_VERTS) pts.push(new THREE.Vector2());
  while (start.length < ALL_ROOMS) {
    start.push(0);
    len.push(0);
    fy.push(-999);
  }
  return { pts, start, len, fy, n };
}

function makeMaterial(s: SurfaceChoice, geometry: ModelGeometry): THREE.ShaderMaterial | null {
  const room = geometry.rooms.find((r) => r.id === s.roomId);
  const m = materialById(s.materialId);
  if (!room || !m || room.polygon.length < 3) return null;
  const poly = room.polygon.slice(0, MAX_VERTS).map((v) => new THREE.Vector2(v.x, v.y));
  while (poly.length < MAX_VERTS) poly.push(new THREE.Vector2());
  const wall = typeof s.target === 'object' ? (geometry.walls[room.floorId] ?? []).find((w) => w.id === (s.target as { wallId: string }).wallId) : null;
  const floor = s.target === 'floor';
  const all = floor ? allFloors(geometry) : null;
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      uPoly: { value: poly },
      uCount: { value: Math.min(room.polygon.length, MAX_VERTS) },
      uFloor: { value: room.floorZ },
      uHeight: { value: room.heightM ?? 2.6 },
      uMode: { value: floor ? 2 : 0 },
      uAll: { value: all?.pts ?? Array.from({ length: ALL_VERTS }, () => new THREE.Vector2()) },
      uStart: { value: all?.start ?? new Array(ALL_ROOMS).fill(0) },
      uLen: { value: all?.len ?? new Array(ALL_ROOMS).fill(0) },
      uFY: { value: all?.fy ?? new Array(ALL_ROOMS).fill(-999) },
      uRooms: { value: all?.n ?? 0 },
      uPattern: { value: m.kind === 'wallpaper' ? 1 : m.kind === 'floor' ? 2 : 0 },
      uSeg: { value: wall ? new THREE.Vector4(wall.a.x, wall.a.y, wall.b.x, wall.b.y) : new THREE.Vector4() },
      uUseSeg: { value: wall ? 1 : 0 },
      uColor: { value: new THREE.Color(m.color) },
      uAccent: { value: new THREE.Color(m.kind === 'wallpaper' ? m.accent : m.color) },
      uAlpha: { value: floor ? 0.8 : 0.66 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

// Also hides furniture behind the scan's walls (see the occluder above).
export default function SurfaceLayer({ geometry }: { geometry: ModelGeometry | null }) {
  const design = useDesign();
  const scene = useThree((s) => s.scene);
  const group = useRef<THREE.Group>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const lastScan = useRef(0);

  // Matterport streams and swaps mesh chunks (LODs, furnished vs empty view), so rescan now and then.
  useFrame(({ clock }) => {
    if (clock.elapsedTime - lastScan.current < 1.5) return;
    lastScan.current = clock.elapsedTime;
    let root: THREE.Object3D = scene;
    while (root.parent) root = root.parent;
    const found = findChunks(root);
    if (found.length !== chunks.length || found.some((c, i) => c !== chunks[i])) {
      setChunks(found);
      bridge.scan = found;
      useViewerState.getState().setPartial({ scanVersion: useViewerState.getState().scanVersion + 1 });
    }
  });

  // Floor heights come from the scan, so rebuild the flooring once the scan has loaded (not on every chunk).
  const scanVersion = useViewerState((v) => v.scanVersion);
  const floorScan = Math.min(scanVersion, 3);
  const materials = useMemo(
    () => (geometry ? design.surfaces.map((s) => makeMaterial(s, geometry)).filter((m): m is THREE.ShaderMaterial => !!m) : []),
    [design.surfaces, geometry, floorScan], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  // One overlay mesh per (surface, chunk), sharing the chunk's geometry, plus one depth-only
  // occluder per chunk: drawn first, it writes the scan's walls into the depth buffer so
  // furniture behind a wall, doorframe or counter is hidden, as it would be in the room.
  // These copies sit on the scan's own layers, so Matterport's pointer (which picks where a click
  // walks to) could land on them instead of the real floor and refuse to move. They draw, but
  // never take part in raycasts.
  const noRaycast = () => {};
  const overlays = useMemo(() => {
    const list: { mesh: THREE.Mesh; chunk: Chunk }[] = [];
    for (const chunk of chunks) {
      const mesh = new THREE.Mesh(chunk.geometry, OCCLUDER);
      mesh.matrixAutoUpdate = false;
      mesh.layers.mask = chunk.layers.mask | 1;
      mesh.renderOrder = -10;
      mesh.frustumCulled = false;
      mesh.raycast = noRaycast;
      list.push({ mesh, chunk });
    }
    for (const mat of materials) {
      for (const chunk of chunks) {
        const mesh = new THREE.Mesh(chunk.geometry, mat);
        mesh.matrixAutoUpdate = false;
        mesh.layers.mask = chunk.layers.mask | 1;
        mesh.renderOrder = 2;
        mesh.frustumCulled = false;
        mesh.raycast = noRaycast;
        list.push({ mesh, chunk });
      }
    }
    return list;
  }, [materials, chunks]);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    overlays.forEach(({ mesh }) => g.add(mesh));
    return () => overlays.forEach(({ mesh }) => g.remove(mesh));
  }, [overlays]);

  // Follow each chunk's transform and visibility (Matterport hides LODs it is not using).
  useFrame(() => {
    for (const { mesh, chunk } of overlays) {
      chunk.updateWorldMatrix(true, false);
      mesh.matrix.copy(chunk.matrixWorld);
      mesh.visible = shownInTree(chunk);
    }
  });

  return <group ref={group} />;
}
