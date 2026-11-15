'use client';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { centroid, pointInPolygon } from '@/lib/geometry';
import { useLighting } from '@/lib/lighting';
import { senseRoom, type Opening } from '@/lib/scanSense';
import { bridge, groundY, useViewerState } from '@/lib/sceneBridge';
import { lightAt, useSite } from '@/lib/sun';
import type { ModelGeometry, Room, Vec2 } from '@/lib/types';

// Sunlight through the home's windows and outside doors for the chosen time of day.
//   - Light on the room itself: the scan's own mesh is drawn again with a shader that, for every
//     point, follows the ray toward the sun and lights the point if that ray leaves through a
//     window or outside door. So the patch lands where it really would: across the floor, up the
//     opposite wall, over a sill, with the window's glazing bars in it.
//   - A faint shaft of light from each sunlit opening to where its light lands.
//   - The sky's colour in the glass: pale blue by day, orange at sunset, dark blue at night.
// Only openings facing the sun light up, so the light moves from the east rooms in the morning
// to the west rooms in the evening. Lamps and bulbs aren't involved.

type Aperture = { kind: 'window' | 'door'; a: Vec2; b: Vec2; inward: Vec2; lo: number; hi: number; floorY: number; room: Room };

const WINDOW_SILL = 0.85;
const WINDOW_HEAD = 2.1;
const DOOR_HEAD = 2.05;
const MAX_LIT = 24;

const noRaycast = () => null; // never block clicks that walk

function inwardNormal(o: Opening, room: Room): Vec2 {
  const len = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y) || 1;
  const n = { x: -(o.b.y - o.a.y) / len, y: (o.b.x - o.a.x) / len };
  return pointInPolygon({ x: o.mid.x + n.x * 0.25, y: o.mid.y + n.y * 0.25 }, room.polygon) ? n : { x: -n.x, y: -n.y };
}

// Openings to the outdoors in the rooms on this floor. Matterport's floor plan lists each wall's
// windows and doorways with their size and sill height; for older models without that, read them
// off the scan mesh instead. A doorway counts only if what's beyond it isn't another room.
function apertures(geometry: ModelGeometry, floorId: string): Aperture[] {
  const rooms = geometry.rooms.filter((r) => r.floorId === floorId && r.polygon.length >= 3);
  const roomAtPoint = (p: Vec2) => rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;
  const floorYOf = new Map<string, number>();
  const floorY = (room: Room) => {
    if (!floorYOf.has(room.id)) {
      const c = centroid(room.polygon);
      floorYOf.set(room.id, groundY(c.x, -c.y, room.floorZ));
    }
    return floorYOf.get(room.id)!;
  };
  const out: Aperture[] = [];
  const walls = geometry.walls[floorId] ?? [];
  if (walls.some((w) => w.openings?.length)) {
    for (const w of walls) {
      const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (len < 0.3) continue;
      const t = { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len };
      const n = { x: -t.y, y: t.x };
      for (const o of w.openings ?? []) {
        const c = { x: w.a.x + (w.b.x - w.a.x) * o.at, y: w.a.y + (w.b.y - w.a.y) * o.at };
        const side = (k: number) => roomAtPoint({ x: c.x + n.x * k, y: c.y + n.y * k });
        const left = side(0.4);
        const right = side(-0.4);
        if (!!left === !!right) continue; // between two rooms, or outside the plan entirely
        const room = (left ?? right)!;
        const inward = left ? n : { x: -n.x, y: -n.y };
        const half = Math.min(o.width, len) / 2;
        const a = { x: c.x - t.x * half, y: c.y - t.y * half };
        const b = { x: c.x + t.x * half, y: c.y + t.y * half };
        const ceiling = room.heightM ?? 2.6;
        const window = o.type === 'window';
        out.push({ kind: window ? 'window' : 'door', a, b, inward, lo: window ? o.sill : 0, hi: Math.min(window ? o.sill + o.height : o.height, ceiling - 0.05), floorY: floorY(room), room });
      }
    }
    return out;
  }
  for (const room of rooms) {
    let s;
    try {
      s = senseRoom(room, { fixtures: false });
    } catch {
      continue;
    }
    if (!s) continue;
    const ceiling = room.heightM ?? 2.5;
    const outside = (o: Opening, n: Vec2) => {
      const p = { x: o.mid.x - n.x * 0.7, y: o.mid.y - n.y * 0.7 };
      return !rooms.some((r) => r.id !== room.id && pointInPolygon(p, r.polygon));
    };
    for (const w of s.windows) {
      const n = inwardNormal(w, room);
      if (outside(w, n)) out.push({ kind: 'window', a: w.a, b: w.b, inward: n, lo: WINDOW_SILL, hi: Math.min(WINDOW_HEAD, ceiling - 0.2), floorY: floorY(room), room });
    }
    for (const d of s.doors) {
      const n = inwardNormal(d, room);
      if (outside(d, n)) out.push({ kind: 'door', a: d.a, b: d.b, inward: n, lo: 0, hi: Math.min(DOOR_HEAD, ceiling - 0.1), floorY: floorY(room), room });
    }
  }
  return out;
}

// How squarely the sun shines through an opening (0 = not at all).
function facing(ap: Aperture, sun: { x: number; y: number; z: number }): number {
  const horiz = Math.hypot(sun.x, sun.y) || 1;
  const f = -(sun.x * ap.inward.x + sun.y * ap.inward.y) / horiz;
  return f < 0.08 || sun.z < 0.02 ? 0 : f;
}

// ---- Light on the scan: one shader over every mesh chunk ----

const projVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const projFragment = /* glsl */ `
  uniform vec3 uSun;            // toward the sun, three.js world
  uniform int uCount;
  uniform vec3 uC[${MAX_LIT}];  // opening centre
  uniform vec3 uU[${MAX_LIT}];  // unit vector along its width
  uniform vec3 uN[${MAX_LIT}];  // unit inward normal (horizontal)
  uniform vec4 uS[${MAX_LIT}];  // half width, half height, strength, glazing bars (1/0)
  uniform vec4 uBox[${MAX_LIT}];// the room's extent: min x, max x, min z, max z
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec3 vWorld;

  float bar(float t, float w) { return 1.0 - 0.72 * (1.0 - smoothstep(0.0, w, abs(t))); }

  void main() {
    vec3 nrm = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float lambert = abs(dot(nrm, uSun));
    float light = 0.0;
    for (int i = 0; i < ${MAX_LIT}; i++) {
      if (i >= uCount) break;
      vec4 box = uBox[i];
      if (vWorld.x < box.x || vWorld.x > box.y || vWorld.z < box.z || vWorld.z > box.w) continue;
      float d = dot(vWorld - uC[i], uN[i]);   // how far into the room
      float sn = dot(uSun, uN[i]);
      if (d < 0.03 || sn > -0.01) continue;
      float t = -d / sn;                       // along the sun ray to the opening's plane
      if (t > 14.0) continue;
      vec3 p = vWorld + uSun * t - uC[i];
      float u = dot(p, uU[i]);
      float v = p.y;
      vec4 s = uS[i];
      float soft = 0.025 + 0.012 * t;          // the sun's disc blurs edges further from the opening
      float a = smoothstep(s.x + soft, s.x - soft, abs(u)) * smoothstep(s.y + soft, s.y - soft, abs(v));
      if (s.w > 0.5) a *= bar(u, 0.03 + 0.004 * t) * bar(v, 0.025 + 0.004 * t);
      light = max(light, a * s.z);
    }
    if (light <= 0.001) discard;
    gl_FragColor = vec4(uColor, light * uAlpha * mix(0.5, 1.0, lambert));
  }
`;

function makeProjector(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: projVertex,
    fragmentShader: projFragment,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uCount: { value: 0 },
      uC: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector3()) },
      uU: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector3()) },
      uN: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector3()) },
      uS: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector4()) },
      uBox: { value: Array.from({ length: MAX_LIT }, () => new THREE.Vector4()) },
      uColor: { value: new THREE.Color('#ffd08a') },
      uAlpha: { value: 0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    toneMapped: false,
  });
}

function shownInTree(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

// ---- Shafts ----

const SHAFT = {
  vertexShader: `attribute float fade; varying float vFade; void main() { vFade = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform vec3 color; uniform float opacity; varying float vFade; void main() { gl_FragColor = vec4(color, vFade * opacity); }`,
};

const ray = new THREE.Raycaster();
ray.layers.enableAll();

// Where the sunlight entering at a point of the opening lands: the first scanned surface along
// the ray, or the floor plane when the scan there isn't loaded.
function landing(from: THREE.Vector3, dir: THREE.Vector3, floorY: number): THREE.Vector3 {
  ray.set(from, dir);
  ray.far = 12;
  const hit = bridge.scan.length ? ray.intersectObjects(bridge.scan, false).find((h) => h.distance > 0.08) : undefined;
  if (hit) return hit.point.clone();
  const t = Math.min(12, (from.y - floorY) / Math.max(0.02, -dir.y));
  return from.clone().addScaledVector(dir, t);
}

function buildShaft(ap: Aperture, sun: THREE.Vector3): THREE.BufferGeometry {
  const dir = sun.clone().negate();
  const P = (v: Vec2, h: number) => new THREE.Vector3(v.x + ap.inward.x * 0.04, ap.floorY + h, -(v.y + ap.inward.y * 0.04));
  const top = [P(ap.a, ap.lo + 0.02), P(ap.b, ap.lo + 0.02), P(ap.b, ap.hi), P(ap.a, ap.hi)];
  const end = top.map((p) => landing(p, dir, ap.floorY));
  const pos: number[] = [];
  const fade: number[] = [];
  const quad = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3) => {
    for (const [v, f] of [[p0, 1], [p1, 1], [p2, 0.1], [p0, 1], [p2, 0.1], [p3, 0.1]] as const) {
      pos.push(v.x, v.y, v.z);
      fade.push(f);
    }
  };
  quad(top[3], top[2], end[2], end[3]); // head of the opening
  quad(top[0], top[1], end[1], end[0]); // sill
  quad(top[0], top[3], end[3], end[0]); // side a
  quad(top[1], top[2], end[2], end[1]); // side b
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
  return g;
}

export default function Sunbeams({ geometry }: { geometry: ModelGeometry | null }) {
  const sunTime = useLighting((s) => s.sun ?? null);
  const { lat, lon, north } = useSite();
  const roomId = useViewerState((s) => s.currentRoomId);
  const scanVersion = useViewerState((s) => s.scanVersion);
  const [aps, setAps] = useState<Aperture[]>([]);
  const group = useRef<THREE.Group>(null);

  const floorId = geometry?.rooms.find((r) => r.id === roomId)?.floorId ?? null;
  const on = sunTime !== null;

  // The windows and outside doors on this floor (looked at again as more of the scan arrives,
  // which only matters for models read off the mesh).
  useEffect(() => {
    if (!on || !geometry || !floorId) return;
    const t = setTimeout(() => setAps(apertures(geometry, floorId)), 400);
    return () => clearTimeout(t);
  }, [geometry, floorId, scanVersion, on]);

  const light = useMemo(() => (sunTime === null ? null : lightAt(sunTime, lat, lon, north)), [sunTime, lat, lon, north]);
  const sun3 = useMemo(() => (light ? new THREE.Vector3(light.dir.x, light.dir.z, -light.dir.y) : null), [light]);

  // Openings the sun shines through right now.
  const lit = useMemo(() => {
    if (!light || light.tone.beamStrength <= 0) return [];
    return aps
      .map((ap) => ({ ap, f: facing(ap, light.dir) }))
      .filter((x) => x.f > 0)
      .sort((p, q) => q.f - p.f)
      .slice(0, MAX_LIT);
  }, [aps, light]);

  // The projector: one material, drawn over every scan chunk.
  const projector = useMemo(() => makeProjector(), []);
  useEffect(() => () => projector.dispose(), [projector]);
  useEffect(() => {
    const u = projector.uniforms;
    if (!light || !sun3) {
      u.uCount.value = 0;
      return;
    }
    u.uSun.value.copy(sun3);
    u.uColor.value.set(light.tone.beam);
    u.uAlpha.value = 0.62 * light.tone.beamStrength;
    lit.forEach(({ ap, f }, i) => {
      const cx = (ap.a.x + ap.b.x) / 2;
      const cy = (ap.a.y + ap.b.y) / 2;
      const w = Math.hypot(ap.b.x - ap.a.x, ap.b.y - ap.a.y) || 1;
      u.uC.value[i].set(cx, ap.floorY + (ap.lo + ap.hi) / 2, -cy);
      u.uU.value[i].set((ap.b.x - ap.a.x) / w, 0, -(ap.b.y - ap.a.y) / w);
      u.uN.value[i].set(ap.inward.x, 0, -ap.inward.y);
      u.uS.value[i].set(w / 2, (ap.hi - ap.lo) / 2, Math.min(1, 0.4 + f * 0.75), ap.kind === 'window' ? 1 : 0);
      const xs = ap.room.polygon.map((p) => p.x);
      const ys = ap.room.polygon.map((p) => p.y);
      u.uBox.value[i].set(Math.min(...xs) - 0.25, Math.max(...xs) + 0.25, -Math.max(...ys) - 0.25, -Math.min(...ys) + 0.25);
    });
    u.uCount.value = lit.length;
  }, [projector, light, sun3, lit]);

  const overlays = useMemo(() => {
    if (!on) return [];
    return bridge.scan.map((chunk) => {
      const mesh = new THREE.Mesh(chunk.geometry, projector);
      mesh.matrixAutoUpdate = false;
      mesh.layers.mask = chunk.layers.mask | 1;
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      mesh.raycast = () => {};
      return { mesh, chunk };
    });
  }, [on, projector, scanVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    overlays.forEach(({ mesh }) => g.add(mesh));
    return () => overlays.forEach(({ mesh }) => g.remove(mesh));
  }, [overlays]);

  useFrame(() => {
    const show = lit.length > 0;
    for (const { mesh, chunk } of overlays) {
      chunk.updateWorldMatrix(true, false);
      mesh.matrix.copy(chunk.matrixWorld);
      mesh.visible = show && shownInTree(chunk);
    }
  });

  // Shafts, rebuilt as the sun moves (a few rays per opening).
  const shafts = useMemo(() => (sun3 ? lit.map(({ ap, f }) => ({ g: buildShaft(ap, sun3), f })) : []), [lit, sun3, scanVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => shafts.forEach((s) => s.g.dispose()), [shafts]);

  // The glass: sky colour by day, darkening to night.
  const panes = useMemo(() => {
    if (!on) return [];
    return aps
      .filter((a) => a.kind === 'window')
      .map((ap) => {
        const g = new THREE.BufferGeometry();
        const v = ([
          [ap.a, ap.lo],
          [ap.b, ap.lo],
          [ap.b, ap.hi],
          [ap.a, ap.hi],
        ] as const).map(([p, h]) => new THREE.Vector3(p.x + ap.inward.x * 0.02, ap.floorY + h, -(p.y + ap.inward.y * 0.02)));
        g.setAttribute('position', new THREE.Float32BufferAttribute(v.flatMap((p) => [p.x, p.y, p.z]), 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        return g;
      });
  }, [aps, on]);
  useEffect(() => () => panes.forEach((g) => g.dispose()), [panes]);

  const beamColor = useMemo(() => new THREE.Color(light?.tone.beam ?? '#ffffff'), [light]);

  return (
    <group ref={group}>
      {light &&
        shafts.map((s, i) => (
          <mesh key={i} geometry={s.g} renderOrder={4} raycast={noRaycast}>
            <shaderMaterial
              args={[{ ...SHAFT, uniforms: { color: { value: beamColor }, opacity: { value: 0.06 * light.tone.beamStrength * Math.min(1, 0.4 + s.f * 0.75) } } }]}
              transparent
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
      {light &&
        panes.map((g, i) =>
          light.sky.night > 0 ? (
            // Night: the glass goes dark blue (normal blending, so it darkens the photo's daylight).
            <mesh key={`p${i}`} geometry={g} renderOrder={2} raycast={noRaycast}>
              <meshBasicMaterial color={light.sky.color} transparent opacity={0.25 + 0.55 * light.sky.night} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          ) : (
            <mesh key={`p${i}`} geometry={g} renderOrder={2} raycast={noRaycast}>
              <meshBasicMaterial color={light.sky.color} transparent opacity={0.16} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          ),
        )}
    </group>
  );
}
