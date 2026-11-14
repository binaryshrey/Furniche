'use client';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { toThree } from '@/lib/coords';
import { checkFit, levelFor } from '@/lib/fit';
import { bridge, useGhost } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { FitLevel, ModelGeometry, PlacedItem, Product } from '@/lib/types';
import Furniture3D from './Furniture3D';
import SurfaceLayer from './SurfaceLayer';

const LEVEL_COLOR: Record<FitLevel, string> = { ok: '#3f8f5a', warn: '#d39b2a', error: '#cf3f2f' };

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
      ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05, depthTest: false })
      : new THREE.LineBasicMaterial({ color, depthTest: false });
    const l = new THREE.Line(geom, mat);
    if (dashed) l.computeLineDistances();
    l.renderOrder = 10;
    return l;
  }, [geom, color, dashed]);
  return <primitive object={line} />;
}

function Item({ item, product, level, selected }: { item: PlacedItem; product: Product; level: FitLevel; selected: boolean }) {
  const [x, y, z] = toThree(item.pos);
  const w = product.dimsCm.w / 100;
  const d = product.dimsCm.d / 100;
  const h = product.dimsCm.h / 100;
  return (
    <group position={[x, y, z]} rotation={[0, item.rot, 0]} userData={{ uid: item.uid }}>
      <Furniture3D category={product.category} w={w} d={d} h={h} color={product.color} />
      {(selected || level !== 'ok') && <Footprint w={w} d={d} color={selected && level === 'ok' ? '#2b2b2b' : LEVEL_COLOR[level]} />}
    </group>
  );
}

function Ghost() {
  const ghost = useGhost((s) => s.ghost);
  const product = useStore((s) => (ghost ? s.product(ghost.productId) : undefined));
  if (!ghost || !product) return null;
  const [x, y, z] = toThree(ghost.pos);
  const w = product.dimsCm.w / 100;
  const d = product.dimsCm.d / 100;
  return (
    <group position={[x, y, z]} rotation={[0, ghost.rot, 0]} userData={{ uid: 'ghost', ghost: true }}>
      <Furniture3D category={product.category} w={w} d={d} h={product.dimsCm.h / 100} color={product.color} opacity={0.55} />
      <Footprint w={w} d={d} color="#2b2b2b" dashed />
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

  const resolved = design.items
    .map((item) => ({ item, product: productOf(item.productId) }))
    .filter((x): x is { item: PlacedItem; product: Product } => !!x.product);
  const issues = useMemo(() => checkFit(resolved, geometry?.rooms ?? [], design.doors), [resolved, geometry, design.doors]);

  return (
    <>
      <CameraBridge />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 8, 4]} intensity={1.1} />
      <hemisphereLight args={['#fffaf0', '#8a7f72', 0.5]} />
      <SurfaceLayer geometry={geometry} />
      <group ref={group}>
        {resolved.map(({ item, product }) => (
          <Item key={item.uid} item={item} product={product} level={levelFor(item.uid, issues)} selected={item.uid === selected} />
        ))}
        <Ghost />
      </group>
    </>
  );
}
