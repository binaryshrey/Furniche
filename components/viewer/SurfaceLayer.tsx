'use client';
import { useMemo } from 'react';
import * as THREE from 'three';
import { materialById } from '@/catalog/materials';
import { useDesign } from '@/lib/store';
import type { ModelGeometry, Room } from '@/lib/types';

// Translucent tints over a room's floor or walls. Approximate: the scan has no window
// or door openings, so wall tints cover the whole wall.
function FloorTint({ room, color }: { room: Room; color: string }) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape(room.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2); // shape XY (API x, y) -> three XZ with z = -y
    return g;
  }, [room]);
  return (
    <mesh geometry={geom} position={[0, room.floorZ + 0.012, 0]} renderOrder={1}>
      <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function WallTint({ room, color }: { room: Room; color: string }) {
  const h = room.heightM ?? 2.6;
  const geom = useMemo(() => {
    const pos: number[] = [];
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const y0 = room.floorZ + 0.02;
      const y1 = room.floorZ + h - 0.05;
      const A = [a.x, y0, -a.y];
      const B = [b.x, y0, -b.y];
      const C = [b.x, y1, -b.y];
      const D = [a.x, y1, -a.y];
      pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }, [room, h]);
  return (
    <mesh geometry={geom} renderOrder={1}>
      <meshBasicMaterial color={color} transparent opacity={0.42} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export default function SurfaceLayer({ geometry }: { geometry: ModelGeometry | null }) {
  const design = useDesign();
  if (!geometry) return null;
  return (
    <group>
      {design.surfaces.map((s) => {
        const room = geometry.rooms.find((r) => r.id === s.roomId);
        const m = materialById(s.materialId);
        if (!room || !m) return null;
        return s.target === 'floor' ? <FloorTint key={s.uid} room={room} color={m.color} /> : <WallTint key={s.uid} room={room} color={m.color} />;
      })}
    </group>
  );
}
