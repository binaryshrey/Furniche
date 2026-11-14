'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { create } from 'zustand';
import { groundY, useViewerState } from '@/lib/sceneBridge';
import type { ModelGeometry } from '@/lib/types';

// Lights the furniture with the room itself. Each time the camera settles on a pano we grab
// Matterport's equirectangular photo of it and use it two ways:
//   - as a prefiltered environment map, so pieces take the room's colours and reflections
//   - to find the brightest spot (a window or ceiling light) and put a shadow-casting light there
// A shadow-only floor (ShadowMaterial) lays those shadows onto the scan's real floor.

type RoomEnv = { env: THREE.Texture | null; light: THREE.Vector3 | null; set: (p: Partial<{ env: THREE.Texture | null; light: THREE.Vector3 | null }>) => void };
export const useRoomEnv = create<RoomEnv>((set) => ({ env: null, light: null, set: (p) => set(p) }));

// Direction (three.js equirect convention, image top = up) of the brightest patch in the upper
// two thirds of the panorama, where windows and fixtures are.
function brightest(img: HTMLImageElement): THREE.Vector3 {
  const W = 128;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  let best = 0;
  let bu = 0.5;
  let bv = 0.3;
  for (let y = 2; y < H * 0.66; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      if (lum > best) [best, bu, bv] = [lum, (x + 0.5) / W, (y + 0.5) / H];
    }
  }
  const phi = (bu - 0.5) * 2 * Math.PI;
  const lat = Math.max((0.5 - bv) * Math.PI, THREE.MathUtils.degToRad(40)); // keep it high so shadows stay short
  return new THREE.Vector3(Math.cos(lat) * Math.cos(phi), Math.sin(lat), Math.cos(lat) * Math.sin(phi)).normalize();
}

function load(uri: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = uri;
  });
}

export default function RoomLighting({ geometry }: { geometry: ModelGeometry | null }) {
  const gl = useThree((s) => s.gl);
  const sdk = useViewerState((s) => s.sdk);
  const roomId = useViewerState((s) => s.currentRoomId);
  const { env, light, set } = useRoomEnv();
  const sun = useRef<THREE.DirectionalLight>(null);

  // Soft shadow maps on the shared renderer; only our light casts, so Matterport is unaffected.
  useEffect(() => {
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
  }, [gl]);

  // Recapture the room's light whenever the camera settles on a new pano.
  useEffect(() => {
    if (!sdk) return;
    const pmrem = new THREE.PMREMGenerator(gl);
    let last = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    const sub = sdk.Sweep.current.subscribe((sw: { sid?: string }) => {
      if (!sw?.sid || sw.sid === last) return;
      last = sw.sid;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const img = await load(await sdk.Renderer.takeEquirectangular());
          if (!alive) return;
          const tex = new THREE.Texture(img);
          tex.mapping = THREE.EquirectangularReflectionMapping;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          const next = pmrem.fromEquirectangular(tex).texture;
          tex.dispose();
          const prev = useRoomEnv.getState().env;
          set({ env: next, light: brightest(img) });
          prev?.dispose();
        } catch {
          /* keep the previous lighting */
        }
      }, 900);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      sub?.cancel?.();
      pmrem.dispose();
    };
  }, [sdk, gl, set]);

  // Shadow-only floor under the current room, and the light aimed at its middle.
  const room = geometry?.rooms.find((r) => r.id === roomId) ?? null;
  const floor = useMemo(() => {
    if (!room) return null;
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // shape XY (API x, y) -> three XZ with z = -y
    return g;
  }, [room]);
  const center = useMemo(() => {
    if (!room) return new THREE.Vector3();
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    return new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, room.floorZ, -(Math.min(...ys) + Math.max(...ys)) / 2);
  }, [room]);
  const span = room ? Math.max(room.widthM, room.depthM) / 2 + 1.5 : 6;
  // The shadow floor sits on the scan's real floor (see groundY).
  const scanVersion = useViewerState((s) => s.scanVersion);
  const floorY = useMemo(() => (room ? groundY(center.x, center.z, room.floorZ) : 0), [room, center, scanVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(() => {
    const s = sun.current;
    if (!s) return;
    const dir = light ?? new THREE.Vector3(0.4, 0.8, 0.3).normalize();
    s.position.copy(center).addScaledVector(dir, 8);
    s.target.position.copy(center);
    s.target.updateMatrixWorld();
  });

  return (
    <>
      {/* With the room's own light available, keep the fill low so pieces aren't flat. */}
      <ambientLight intensity={env ? 0.15 : 0.9} />
      <hemisphereLight args={['#fffaf0', '#8a7f72', env ? 0.25 : 0.5]} />
      <directionalLight
        ref={sun}
        intensity={env ? 0.9 : 1.1}
        castShadow
        shadow-mapSize={[1024, 1024]} // lower resolution reads as softer, more natural edges
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
      />
      {floor && (
        <mesh geometry={floor} position={[0, floorY + 0.006, 0]} receiveShadow renderOrder={1}>
          <shadowMaterial transparent opacity={0.2} depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
        </mesh>
      )}
    </>
  );
}
