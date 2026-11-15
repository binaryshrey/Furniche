'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { toThree } from '@/lib/coords';
import { checkFit, levelFor, roomAt } from '@/lib/fit';
import { hangLift, pictureUrl } from '@/lib/hang';
import { bridge, groundY, pickOnly, useGhost, useViewerState } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { FitLevel, ModelGeometry, PlacedItem, Product, Room } from '@/lib/types';
import Furniture3D from './Furniture3D';
import RealModel, { hasRealModel } from './RealModel';
import RoomLighting, { useRoomEnv } from './RoomLighting';
import Sunbeams from './Sunbeams';
import SurfaceLayer from './SurfaceLayer';

// Shadows and outlines are decoration: clicks go through them to the floor (and walk there).
const noClicks = () => {};

const LEVEL_COLOR: Record<FitLevel, string> = { ok: '#3f8f5a', warn: '#d39b2a', error: '#cf3f2f' };

// Outlines and shading depth-test like everything else: the scan mesh occluder (SurfaceLayer)
// hides them behind walls, and they sit just above the floor so they still read on it.
function Footprint({ w, d, color, dashed }: { w: number; d: number; color: string; dashed?: boolean }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(
      [
        [-w / 2, -d / 2],
        [w / 2, -d / 2],
        [w / 2, d / 2],
        [-w / 2, d / 2],
        [-w / 2, -d / 2],
      ].map(([x, z]) => new THREE.Vector3(x, 0.015, z)),
    );
    return g;
  }, [w, d]);
  const line = useMemo(() => {
    const mat = dashed
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05, depthTest: true })
      : new THREE.LineBasicMaterial({ color, depthTest: true });
    const l = new THREE.Line(geom, mat);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 10;
    l.raycast = noClicks;
    return l;
  }, [geom, color, dashed]);
  return <primitive object={line} />;
}

// A shaded patch under a piece so a problem reads at a glance, not just as a thin outline.
// Selection outline for a wall piece: a white frame just in front of it, upright like the piece.
function WallOutline({ w, h }: { w: number; h: number }) {
  const line = useMemo(() => {
    const m = 0.03;
    const pts = [[-w / 2 - m, -m], [w / 2 + m, -m], [w / 2 + m, h + m], [-w / 2 - m, h + m], [-w / 2 - m, -m]].map(([x, y]) => new THREE.Vector3(x, y, 0.06));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false }));
    l.renderOrder = 12;
    l.raycast = noClicks;
    return l;
  }, [w, h]);
  return <primitive object={line} />;
}

function Shade({ w, d, color, opacity }: { w: number; d: number; color: string; opacity: number }) {
  return (
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9} raycast={noClicks}>
      <planeGeometry args={[w, d]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthTest depthWrite={false} />
    </mesh>
  );
}

// Soft contact shadow under every piece so nothing looks pasted on: a blurred rounded rectangle,
// drawn once and shared.
let contactTexture: THREE.Texture | null = null;
function contactShadow(): THREE.Texture {
  if (contactTexture) return contactTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(12px)';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath();
  ctx.roundRect(22, 22, 84, 84, 16);
  ctx.fill();
  contactTexture = new THREE.CanvasTexture(c);
  return contactTexture;
}

function ContactShadow({ w, d, opacity = 0.38 }: { w: number; d: number; opacity?: number }) {
  return (
    <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} raycast={noClicks}>
      <planeGeometry args={[w * 1.45, d * 1.45]} />
      <meshBasicMaterial map={contactShadow()} color="#000000" transparent opacity={opacity} depthWrite={false} polygonOffset polygonOffsetFactor={-1} />
    </mesh>
  );
}

const tint = (color: string, toward: string, k: number) => '#' + new THREE.Color(color).lerp(new THREE.Color(toward), k).getHexString();

// A mattress lying on a bed frame: the frame's own model already shows it made up.
function onABed(m: PlacedItem, all: { item: PlacedItem; product: Product }[]): boolean {
  return all.some(({ item, product }) => product.category === 'bed' && Math.hypot(item.pos.x - m.pos.x, item.pos.y - m.pos.y) < 0.3);
}

// New pieces settle into place: they rise from just above their spot while growing to full size,
// each a beat after the last when several arrive together (auto-furnish), so the room fills in
// instead of popping into existence. Pieces already in the design when the view opens do not animate.
const SETTLE_S = 0.6;

function Item({ item, product, level, selected, delay, floorZ }: { item: PlacedItem; product: Product; level: FitLevel; selected: boolean; delay: number | null; floorZ: number | null }) {
  const [x, approxY, z] = toThree(item.pos);
  // Rest on the scan's real floor, not the estimated floor height.
  const scanVersion = useViewerState((s) => s.scanVersion);
  const onWall = product.placement === 'wall';
  // Wall pieces hang at their own height; everything else rests on the scan's floor.
  const y = useMemo(() => (onWall ? approxY : groundY(x, z, approxY)), [x, z, approxY, onWall, scanVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = product.dimsCm.w / 100;
  const d = product.dimsCm.d / 100;
  const h = product.dimsCm.h / 100;
  // Pieces placed at floor height hang at the standard height; pieces hung on a wall (wall
  // snapping, staging) already carry their height in pos.z.
  const lift = floorZ !== null && item.pos.z - floorZ > 0.25 ? 0 : hangLift(product);
  const hung = product.placement === 'wall';
  const root = useRef<THREE.Group>(null);
  const t0 = useRef<number | null>(null);
  const settled = useRef(delay === null);

  useFrame(({ clock }) => {
    const g = root.current;
    if (!g || settled.current || delay === null) return;
    if (t0.current === null) {
      t0.current = clock.elapsedTime;
      g.visible = false;
    }
    const k = Math.min(1, Math.max(0, (clock.elapsedTime - t0.current - delay) / SETTLE_S));
    const e = 1 - Math.pow(1 - k, 3); // ease-out
    g.visible = k > 0;
    g.scale.setScalar(0.92 + 0.08 * e);
    g.position.y = y + lift + (1 - e) * 0.14;
    if (k >= 1) {
      settled.current = true;
      g.visible = true;
      g.scale.setScalar(1);
      g.position.y = y + lift;
    }
  });

  return (
    <group ref={root} position={[x, y + lift, z]} rotation={[0, item.rot, 0]} userData={{ uid: item.uid }}>
      {hasRealModel(product) ? (
        <RealModel product={product} w={w} d={d} h={h} warnTint={level === 'error' ? LEVEL_COLOR.error : undefined} />
      ) : (
        <Furniture3D category={product.category} w={w} d={d} h={h} color={level === 'error' ? tint(product.color, LEVEL_COLOR.error, 0.55) : product.color} image={pictureUrl(product)} name={product.name} />
      )}
      {product.category !== 'rug' && !hung && <ContactShadow w={w} d={d} />}
      {!hung && level !== 'ok' && <Shade w={w} d={d} color={LEVEL_COLOR[level]} opacity={level === 'error' ? 0.38 : 0.26} />}
      {!hung && (selected || level !== 'ok') && <Footprint w={w} d={d} color={selected && level === 'ok' ? '#ffffff' : LEVEL_COLOR[level]} />}
      {hung && selected && <WallOutline w={w} h={h} />}
    </group>
  );
}

// The room's floor outline, shown while a piece is selected or being dropped: the area it must fit in.
function RoomOutline({ room, color }: { room: Room; color: string }) {
  const line = useMemo(() => {
    const pts = [...room.polygon, room.polygon[0]].map((p) => new THREE.Vector3(...toThree({ x: p.x, y: p.y, z: room.floorZ + 0.02 })));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.1, depthTest: true }));
    l.computeLineDistances();
    l.renderOrder = 11;
    return l;
  }, [room, color]);
  return <primitive object={line} />;
}

// The piece being dropped, coloured by whether it would fit where it is right now.
function Ghost({ level }: { level: FitLevel }) {
  const ghost = useGhost((s) => s.ghost);
  const product = useStore((s) => (ghost ? s.product(ghost.productId) : undefined));
  const floorAt = useViewerState((s) => s.cameraFloorZ);
  if (!ghost || !product) return null;
  const [x, y, z] = toThree(ghost.pos);
  const w = product.dimsCm.w / 100;
  const d = product.dimsCm.d / 100;
  const ghostLift = ghost.pos.z - floorAt > 0.25 ? 0 : hangLift(product); // already at hanging height
  return (
    <group position={[x, y + ghostLift, z]} rotation={[0, ghost.rot, 0]} userData={{ uid: 'ghost', ghost: true }}>
      {hasRealModel(product) ? (
        <RealModel product={product} w={w} d={d} h={product.dimsCm.h / 100} opacity={0.55} />
      ) : (
        <Furniture3D category={product.category} w={w} d={d} h={product.dimsCm.h / 100} color={product.color} opacity={0.55} image={pictureUrl(product)} name={product.name} />
      )}
      {product.placement !== 'wall' && <Shade w={w} d={d} color={LEVEL_COLOR[level]} opacity={0.3} />}
      {product.placement !== 'wall' && <Footprint w={w} d={d} color={LEVEL_COLOR[level]} dashed />}
    </group>
  );
}

function CameraBridge() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    bridge.camera = camera;
  }, [camera]);
  useFrame(({ camera: c }) => {
    bridge.camera = c;
  });
  return null;
}

export default function FurnitureLayer({ geometry }: { geometry: ModelGeometry | null }) {
  const design = useDesign();
  const selected = useStore((s) => s.selectedUid);
  const productOf = useStore((s) => s.product);
  const group = useRef<THREE.Group>(null);

  useEffect(() => {
    bridge.furniture = group.current;
  });
  // New pieces (and models that finish loading) become pick-only a moment after they appear.
  const lastPick = useRef(0);
  useFrame(({ clock }) => {
    if (!group.current || clock.elapsedTime - lastPick.current < 0.5) return;
    lastPick.current = clock.elapsedTime;
    pickOnly(group.current);
  });

  // Every piece reflects the room (its panorama as the environment map) and casts shadows from
  // the room's main light. Checked a few times a second so newly added pieces pick it up too.
  const env = useRoomEnv((s) => s.env);
  const tick = useRef(0);
  useFrame(() => {
    if (++tick.current % 15 || !group.current) return;
    group.current.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const std = mat as THREE.MeshStandardMaterial;
        if (!std.isMeshStandardMaterial) continue;
        m.castShadow = true;
        m.receiveShadow = true; // a table's shadow lands on the rug, a lamp's on the sofa
        if (std.envMap !== env) {
          std.envMap = env;
          std.envMapIntensity = 1;
          std.needsUpdate = true;
        }
      }
    });
  });

  const resolved = design.items
    .map((item) => ({ item, product: productOf(item.productId) }))
    .filter((x): x is { item: PlacedItem; product: Product } => !!x.product);
  const issues = useMemo(() => checkFit(resolved, geometry?.rooms ?? [], design.doors, geometry?.walls), [resolved, geometry, design.doors]);

  // Pieces in the design when the view first shows are not animated; later ones settle in, staggered.
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(resolved.map((r) => r.item.uid));
  const fresh = resolved.filter((r) => !initial.current!.has(r.item.uid)).map((r) => r.item.uid);
  const floorOf = (roomId: string | null) => geometry?.rooms.find((r) => r.id === roomId)?.floorZ ?? null;
  const delayOf = (uid: string) => (initial.current!.has(uid) ? null : Math.min(fresh.indexOf(uid) * 0.09, 0.9));

  // Live fit for the piece being dropped.
  const ghost = useGhost((s) => s.ghost);
  const ghostProduct = ghost ? productOf(ghost.productId) : undefined;
  const ghostLevel = useMemo<FitLevel>(() => {
    if (!ghost || !ghostProduct || !geometry) return 'ok';
    const g = { uid: '__ghost', productId: ghost.productId, pos: ghost.pos, rot: ghost.rot, roomId: roomAt(ghost.pos, geometry.rooms)?.id ?? null };
    return levelFor('__ghost', checkFit([...resolved, { item: g, product: ghostProduct }], geometry.rooms, design.doors, geometry.walls));
  }, [ghost, ghostProduct, geometry, resolved, design.doors]);

  // Which room outline to show, and in what colour.
  const focus = ghost ? { pos: ghost.pos, level: ghostLevel } : (() => {
    const it = resolved.find((r) => r.item.uid === selected);
    return it ? { pos: it.item.pos, level: levelFor(it.item.uid, issues) } : null;
  })();
  const focusRoom = focus && geometry ? roomAt(focus.pos, geometry.rooms) : null;

  return (
    <>
      <CameraBridge />
      <RoomLighting geometry={geometry} />
      <Sunbeams geometry={geometry} />
      <SurfaceLayer geometry={geometry} />
      <group ref={group}>
        {resolved
          .filter(({ item, product }) => !(product.category === 'mattress' && onABed(item, resolved)))
          .map(({ item, product }) => (
            <Item key={item.uid} item={item} product={product} level={levelFor(item.uid, issues)} selected={item.uid === selected} delay={delayOf(item.uid)} floorZ={floorOf(item.roomId)} />
        ))}
        <Ghost level={ghostLevel} />
      </group>
      {focusRoom && <RoomOutline room={focusRoom} color={focus!.level === 'error' ? LEVEL_COLOR.error : '#ffffff'} />}
    </>
  );
}
