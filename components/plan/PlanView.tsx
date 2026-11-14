'use client';
import { useMemo, useRef, useState } from 'react';
import { centroid, distPointSegment } from '@/lib/geometry';
import { checkFit, footprint, levelFor, roomAt } from '@/lib/fit';
import { useViewerState } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { FitLevel, ModelGeometry, PlacedItem, Product, Vec2 } from '@/lib/types';

const FILL: Record<FitLevel, string> = { ok: '#6cc08a', warn: '#e6ae45', error: '#ea6a58' };

// Top-down plan of the active floor from Matterport's wall graph. API frame: x right, y up,
// so SVG y is flipped. Supports placing, dragging and marking doors.
export default function PlanView({ geometry }: { geometry: ModelGeometry }) {
  const design = useDesign();
  const productOf = useStore((s) => s.product);
  const pending = useStore((s) => s.pendingProductId);
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selectedUid);
  const currentRoomId = useViewerState((s) => s.currentRoomId);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ uid: string; off: Vec2 } | null>(null);
  const [hover, setHover] = useState<Vec2 | null>(null);

  const floorId =
    geometry.rooms.find((r) => r.id === currentRoomId)?.floorId ?? geometry.floors[0]?.id ?? Object.keys(geometry.walls)[0];
  const walls = geometry.walls[floorId] ?? [];
  const rooms = geometry.rooms.filter((r) => r.floorId === floorId);
  const floorZ = geometry.floors.find((f) => f.id === floorId)?.z ?? 0;

  const box = useMemo(() => {
    const pts = walls.flatMap((w) => [w.a, w.b]);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = 0.8;
    return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
  }, [walls]);

  const resolved = design.items
    .map((item) => ({ item, product: productOf(item.productId) }))
    .filter((x): x is { item: PlacedItem; product: Product } => !!x.product)
    .filter((x) => x.product.placement !== 'outdoor');
  const issues = useMemo(() => checkFit(resolved, geometry.rooms, design.doors, geometry.walls), [resolved, geometry, design.doors]);

  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: -p.y };
  };
  const st = () => useStore.getState();

  const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${-p.y}`).join(' ');

  return (
    <div className="relative h-full w-full bg-paper">
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        viewBox={`${box.minX} ${-box.maxY} ${box.maxX - box.minX} ${box.maxY - box.minY}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerMove={(e) => {
          const w = toWorld(e);
          setHover(w);
          const d = drag.current;
          if (d) {
            const it = design.items.find((i) => i.uid === d.uid);
            if (!it) return;
            const pos = { x: w.x + d.off.x, y: w.y + d.off.y, z: it.pos.z };
            st().moveItem(d.uid, pos, roomAt(pos, geometry.rooms)?.id ?? null);
          }
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => {
          drag.current = null;
          const w = toWorld(e);
          if (pending) {
            const pos = { x: w.x, y: w.y, z: floorZ };
            st().addItem(pending, pos, roomAt(pos, geometry.rooms)?.id ?? null, 0);
            st().setPending(null);
          } else if (mode === 'door') {
            let best: { d: number; p: Vec2 } | null = null;
            for (const wall of walls) {
              const d = distPointSegment(w, wall.a, wall.b);
              if (!best || d < best.d) {
                const dx = wall.b.x - wall.a.x;
                const dy = wall.b.y - wall.a.y;
                const t = Math.max(0, Math.min(1, ((w.x - wall.a.x) * dx + (w.y - wall.a.y) * dy) / (dx * dx + dy * dy || 1)));
                best = { d, p: { x: wall.a.x + t * dx, y: wall.a.y + t * dy } };
              }
            }
            if (best && best.d < 0.6) {
              const nudged = rooms.find((r) => roomAt({ x: best!.p.x, y: best!.p.y }, [r])) ?? roomAt(w, rooms);
              const room = nudged ?? roomAt(w, rooms);
              if (room) st().addDoor({ roomId: room.id, pos: best.p, widthM: 0.81 });
            }
          }
        }}
      >
        {rooms.map((r) => {
          const c = centroid(r.polygon);
          return (
            <g key={r.id}>
              <polygon points={pts(r.polygon)} fill={r.id === currentRoomId ? '#2c2729' : '#1c191a'} stroke="none" />
              <text x={c.x} y={-c.y} fontSize={0.28} textAnchor="middle" fill="#b3aba1" style={{ pointerEvents: 'none' }}>
                {r.label}
              </text>
              <text x={c.x} y={-c.y + 0.32} fontSize={0.2} textAnchor="middle" fill="#7d756d" style={{ pointerEvents: 'none' }}>
                {r.widthM.toFixed(1)} × {r.depthM.toFixed(1)} m
              </text>
            </g>
          );
        })}
        {walls.map((w) => (
          <line key={w.id} x1={w.a.x} y1={-w.a.y} x2={w.b.x} y2={-w.b.y} stroke="#efe9df" strokeWidth={Math.max(0.06, w.thickness)} strokeLinecap="round" />
        ))}
        {design.doors
          .filter((d) => rooms.some((r) => r.id === d.roomId))
          .map((d) => (
            <g key={d.uid} onPointerDown={(e) => (e.stopPropagation(), mode === 'door' && st().removeDoor(d.uid))}>
              <circle cx={d.pos.x} cy={-d.pos.y} r={d.widthM} fill="rgba(217,151,111,.14)" stroke="#d9976f" strokeWidth={0.02} strokeDasharray="0.06 0.05" />
              <rect x={d.pos.x - 0.12} y={-d.pos.y - 0.12} width={0.24} height={0.24} fill="#d9976f" />
            </g>
          ))}
        {resolved.map(({ item, product }) => {
          const level = levelFor(item.uid, issues);
          const isSel = item.uid === selected;
          return (
            <polygon
              key={item.uid}
              points={pts(footprint(item, product))}
              fill={product.category === 'rug' ? product.color + '99' : product.color}
              stroke={level === 'ok' ? (isSel ? '#efe9df' : '#8a8279') : FILL[level]}
              strokeWidth={isSel || level !== 'ok' ? 0.05 : 0.02}
              style={{ cursor: 'grab' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                st().select(item.uid);
                if (st().design().locked) return; // locked: select only
                const w = toWorld(e);
                drag.current = { uid: item.uid, off: { x: item.pos.x - w.x, y: item.pos.y - w.y } };
              }}
            />
          );
        })}
        {pending && hover && (() => {
          const p = productOf(pending);
          if (!p) return null;
          return <polygon points={pts(footprint({ uid: 'g', productId: p.id, roomId: null, pos: { ...hover, z: 0 }, rot: 0 }, p))} fill={p.color} opacity={0.5} stroke="#efe9df" strokeDasharray="0.08 0.05" strokeWidth={0.03} />;
        })()}
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-card/90 px-2 py-1 text-[11px] text-muted">
        {mode === 'door' ? 'Click a wall to mark a door; click a door to remove it.' : pending ? 'Click to place.' : 'Drag pieces to move them.'} Door positions are not in the scan data.
      </div>
    </div>
  );
}
