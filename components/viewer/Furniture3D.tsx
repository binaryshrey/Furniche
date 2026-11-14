'use client';
import { useMemo } from 'react';
import * as THREE from 'three';
import type { Category } from '@/lib/types';

// Procedural stand-in furniture, built at the product's exact size.
// Local frame (three.js): origin at the bottom centre, width along X, depth along Z,
// the front faces +Z, height along +Y.

type Props = { category: Category; w: number; d: number; h: number; color: string; opacity?: number };

const LEG = '#3b332d';
const METAL = '#2f3235';
const LINEN = '#f4f1ea';

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return '#' + c.getHexString();
}

function Box({ p, s, c, opacity = 1 }: { p: [number, number, number]; s: [number, number, number]; c: string; opacity?: number }) {
  return (
    <mesh position={p} castShadow receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={0.85} metalness={0.02} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Cyl({ p, r, h, c, rTop, opacity = 1, seg = 20 }: { p: [number, number, number]; r: number; h: number; c: string; rTop?: number; opacity?: number; seg?: number }) {
  return (
    <mesh position={p} castShadow>
      <cylinderGeometry args={[rTop ?? r, r, h, seg]} />
      <meshStandardMaterial color={c} roughness={0.7} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Legs({ w, d, h, inset = 0.05, r = 0.02, c = LEG, opacity }: { w: number; d: number; h: number; inset?: number; r?: number; c?: string; opacity?: number }) {
  const x = w / 2 - inset;
  const z = d / 2 - inset;
  return (
    <>
      {[
        [-x, -z],
        [x, -z],
        [-x, z],
        [x, z],
      ].map(([lx, lz], i) => (
        <Cyl key={i} p={[lx, h / 2, lz]} r={r} h={h} c={c} opacity={opacity} />
      ))}
    </>
  );
}

function Seating({ w, d, h, color, opacity, arms = true, chaise = false }: Props & { arms?: boolean; chaise?: boolean }) {
  const legH = 0.1;
  const seatH = Math.min(0.45, h * 0.55);
  const back = Math.min(0.22, d * 0.25);
  const arm = arms ? Math.min(0.16, w * 0.1) : 0;
  const cushion = shade(color, 0.05);
  return (
    <group>
      <Legs w={w} d={d} h={legH} inset={0.06} r={0.018} opacity={opacity} />
      <Box p={[0, legH + (seatH - legH) / 2 - 0.06, 0]} s={[w, seatH - legH - 0.12, d]} c={color} opacity={opacity} />
      <Box p={[0, seatH - 0.07, back / 2]} s={[w - arm * 2 - 0.02, 0.14, d - back - 0.02]} c={cushion} opacity={opacity} />
      <Box p={[0, (h + legH) / 2, -d / 2 + back / 2]} s={[w, h - legH, back]} c={color} opacity={opacity} />
      {arms && (
        <>
          <Box p={[-w / 2 + arm / 2, (seatH + 0.18 + legH) / 2, 0]} s={[arm, seatH + 0.18 - legH, d]} c={color} opacity={opacity} />
          <Box p={[w / 2 - arm / 2, (seatH + 0.18 + legH) / 2, 0]} s={[arm, seatH + 0.18 - legH, d]} c={color} opacity={opacity} />
        </>
      )}
      {chaise && <Box p={[-w / 2 + w * 0.2, seatH - 0.07, d / 2 - 0.3]} s={[w * 0.36, 0.15, 0.6]} c={shade(color, -0.04)} opacity={opacity} />}
    </group>
  );
}

function Table({ w, d, h, color, opacity, round = false }: Props & { round?: boolean }) {
  const top = 0.035;
  if (round) {
    return (
      <group>
        <Cyl p={[0, h - top / 2, 0]} r={w / 2} h={top} c={color} opacity={opacity} seg={40} />
        <Cyl p={[0, (h - top) / 2, 0]} r={0.05} h={h - top} c={shade(color, -0.1)} opacity={opacity} />
        <Cyl p={[0, 0.02, 0]} r={w * 0.22} h={0.04} c={shade(color, -0.1)} opacity={opacity} seg={32} />
      </group>
    );
  }
  return (
    <group>
      <Box p={[0, h - top / 2, 0]} s={[w, top, d]} c={color} opacity={opacity} />
      <Legs w={w} d={d} h={h - top} inset={0.05} r={0.022} c={shade(color, -0.15)} opacity={opacity} />
    </group>
  );
}

function Chair({ w, d, h, color, opacity, seatH = 0.46, back = true }: Props & { seatH?: number; back?: boolean }) {
  return (
    <group>
      <Legs w={w} d={d} h={seatH - 0.03} inset={0.04} r={0.015} c={shade(color, -0.2)} opacity={opacity} />
      <Box p={[0, seatH - 0.015, 0]} s={[w, 0.04, d]} c={color} opacity={opacity} />
      {back && <Box p={[0, (seatH + h) / 2, -d / 2 + 0.02]} s={[w, h - seatH, 0.035]} c={color} opacity={opacity} />}
    </group>
  );
}

function Cabinet({ w, d, h, color, opacity, drawers = 3, legH = 0.08 }: Props & { drawers?: number; legH?: number }) {
  const body = h - legH;
  const line = shade(color, -0.12);
  return (
    <group>
      <Legs w={w} d={d} h={legH} inset={0.04} r={0.015} opacity={opacity} />
      <Box p={[0, legH + body / 2, 0]} s={[w, body, d]} c={color} opacity={opacity} />
      {Array.from({ length: drawers - 1 }).map((_, i) => (
        <Box key={i} p={[0, legH + (body * (i + 1)) / drawers, d / 2 + 0.002]} s={[w - 0.04, 0.008, 0.004]} c={line} opacity={opacity} />
      ))}
    </group>
  );
}

function Shelf({ w, d, h, color, opacity }: Props) {
  const t = 0.02;
  const shelves = Math.max(2, Math.round(h / 0.38));
  return (
    <group>
      <Box p={[-w / 2 + t / 2, h / 2, 0]} s={[t, h, d]} c={color} opacity={opacity} />
      <Box p={[w / 2 - t / 2, h / 2, 0]} s={[t, h, d]} c={color} opacity={opacity} />
      <Box p={[0, h / 2, -d / 2 + 0.005]} s={[w, h, 0.01]} c={shade(color, -0.05)} opacity={opacity} />
      {Array.from({ length: shelves + 1 }).map((_, i) => (
        <Box key={i} p={[0, (h - t) * (i / shelves) + t / 2, 0]} s={[w, t, d]} c={color} opacity={opacity} />
      ))}
    </group>
  );
}

function Bed({ w, d, h, color, opacity }: Props) {
  const frame = 0.32;
  return (
    <group>
      <Box p={[0, frame / 2, 0.02]} s={[w, frame, d - 0.04]} c={color} opacity={opacity} />
      <Box p={[0, frame + 0.11, 0.04]} s={[w - 0.06, 0.22, d - 0.12]} c={LINEN} opacity={opacity} />
      <Box p={[0, frame + 0.16, d * 0.18]} s={[w - 0.05, 0.08, d * 0.55]} c={shade(color, 0.2)} opacity={opacity} />
      <Box p={[0, h / 2, -d / 2 + 0.03]} s={[w, h, 0.06]} c={color} opacity={opacity} />
      {[-1, 1].map((s) => (
        <Box key={s} p={[s * w * 0.24, frame + 0.27, -d / 2 + 0.25]} s={[w * 0.4, 0.12, 0.32]} c="#ffffff" opacity={opacity} />
      ))}
    </group>
  );
}

function Lamp({ w, h, color, opacity }: Props) {
  return (
    <group>
      <Cyl p={[0, 0.015, 0]} r={Math.min(0.15, w / 2)} h={0.03} c={METAL} opacity={opacity} />
      <Cyl p={[0, h / 2, 0]} r={0.012} h={h} c={color} opacity={opacity} />
      <mesh position={[0, h - 0.15, 0]}>
        <cylinderGeometry args={[0.13, 0.2, 0.3, 24, 1, true]} />
        <meshStandardMaterial color="#f6efe0" emissive="#f3d9a4" emissiveIntensity={0.35} side={THREE.DoubleSide} transparent={(opacity ?? 1) < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}

function Plant({ w, h, opacity, pot = '#cdbfa8', foliage = '#4c6b45' }: Props & { pot?: string; foliage?: string }) {
  const potH = Math.min(0.4, h * 0.3);
  return (
    <group>
      <Cyl p={[0, potH / 2, 0]} r={w * 0.32} rTop={w * 0.4} h={potH} c={pot} opacity={opacity} />
      {h > 0.6 &&
        [0.55, 0.75, 0.92].map((f, i) => (
          <mesh key={i} position={[(i - 1) * 0.06, h * f, (i % 2) * 0.05]} castShadow>
            <sphereGeometry args={[w * (0.5 - i * 0.08), 16, 12]} />
            <meshStandardMaterial color={foliage} roughness={0.9} transparent={(opacity ?? 1) < 1} opacity={opacity} />
          </mesh>
        ))}
    </group>
  );
}

function Panel({ w, h, d, color, opacity, frame = true }: Props & { frame?: boolean }) {
  return (
    <group>
      {frame && <Box p={[0, h / 2, 0]} s={[w, h, Math.max(d, 0.02)]} c={color} opacity={opacity} />}
      <Box p={[0, h / 2, Math.max(d, 0.02) / 2 + 0.002]} s={[w - 0.06, h - 0.06, 0.004]} c={frame ? '#dfe6ea' : color} opacity={opacity} />
    </group>
  );
}

export default function Furniture3D(props: Props) {
  const { category, w, d, h, color, opacity = 1 } = props;
  const p = { ...props, opacity };
  return useMemo(() => {
    switch (category) {
      case 'sofa':
        return <Seating {...p} />;
      case 'sectional':
        return <Seating {...p} chaise />;
      case 'armchair':
        return <Seating {...p} />;
      case 'bench':
        return <Table {...p} color={color} />;
      case 'coffee-table':
      case 'side-table':
      case 'dining-table':
      case 'desk':
      case 'patio-table':
        return <Table {...p} />;
      case 'round-table':
        return <Table {...p} round />;
      case 'dining-chair':
      case 'patio-chair':
        return <Chair {...p} />;
      case 'office-chair':
        return <Chair {...p} seatH={0.5} />;
      case 'bar-stool':
        return <Chair {...p} seatH={h} back={false} />;
      case 'bed':
        return <Bed {...p} />;
      case 'nightstand':
        return <Cabinet {...p} drawers={2} />;
      case 'dresser':
        return <Cabinet {...p} drawers={3} />;
      case 'wardrobe':
        return <Cabinet {...p} drawers={1} legH={0.03} />;
      case 'tv-console':
        return <Cabinet {...p} drawers={2} legH={0.1} />;
      case 'bookshelf':
        return <Shelf {...p} />;
      case 'floor-lamp':
        return <Lamp {...p} />;
      case 'rug':
        return <Box p={[0, 0.006, 0]} s={[w, 0.012, d]} c={color} opacity={opacity} />;
      case 'plant':
        return <Plant {...p} />;
      case 'planter':
        return <Plant {...p} pot={color} />;
      case 'mirror':
        return <Panel {...p} />;
      case 'wall-art':
        return <Panel {...p} frame={false} />;
      case 'lounger':
        return (
          <group>
            <Box p={[0, 0.18, 0.15]} s={[w, 0.12, d - 0.3]} c={color} opacity={opacity} />
            <group position={[0, 0.2, -d / 2 + 0.3]} rotation={[0.6, 0, 0]}>
              <Box p={[0, 0.25, 0]} s={[w, 0.5, 0.1]} c={color} opacity={opacity} />
            </group>
            <Legs w={w} d={d - 0.2} h={0.13} c={LEG} opacity={opacity} />
          </group>
        );
      case 'umbrella':
        return (
          <group>
            <Cyl p={[0, h / 2, 0]} r={0.02} h={h} c={METAL} opacity={opacity} />
            <mesh position={[0, h - 0.25, 0]}>
              <coneGeometry args={[w / 2, 0.5, 8, 1, true]} />
              <meshStandardMaterial color={color} side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} />
            </mesh>
            <Cyl p={[0, 0.03, 0]} r={0.25} h={0.06} c={METAL} opacity={opacity} />
          </group>
        );
      default:
        return <Box p={[0, h / 2, 0]} s={[w, h, d]} c={color} opacity={opacity} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, w, d, h, color, opacity]);
}
