'use client';
import { MATERIALS, materialById, quantityFor, wallAreaSqFt, type Material } from '@/catalog/materials';
import { useDesign, useStore } from '@/lib/store';
import type { ModelGeometry } from '@/lib/types';
import { fmtUsd } from '../shop/ShopPanel';

function perimeter(poly: { x: number; y: number }[]) {
  return poly.reduce((s, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return s + Math.hypot(q.x - p.x, q.y - p.y);
  }, 0);
}

export function surfaceLines(geometry: ModelGeometry | null, surfaces: ReturnType<typeof useDesign>['surfaces'], doors: ReturnType<typeof useDesign>['doors']) {
  return surfaces
    .map((s) => {
      const room = geometry?.rooms.find((r) => r.id === s.roomId);
      const m = materialById(s.materialId);
      if (!room || !m) return null;
      const area =
        s.target === 'floor'
          ? room.areaM2 * 10.7639
          : wallAreaSqFt(perimeter(room.polygon), room.heightM ?? 2.6, doors.filter((d) => d.roomId === room.id).length);
      return { s, room, m, area, ...quantityFor(m, area) };
    })
    .filter(Boolean) as { s: (typeof surfaces)[number]; room: NonNullable<ModelGeometry['rooms'][number]>; m: Material; area: number; qty: number; unit: string; cost: number }[];
}

export default function SurfacesBox({ geometry, roomId }: { geometry: ModelGeometry | null; roomId: string | null }) {
  const design = useDesign();
  const room = geometry?.rooms.find((r) => r.id === roomId) ?? null;
  const { setSurface, removeSurface } = useStore.getState();
  const lines = surfaceLines(geometry, design.surfaces, design.doors).filter((l) => l.room.id === roomId);
  const current = (target: 'walls' | 'floor') => design.surfaces.find((s) => s.roomId === roomId && s.target === target)?.materialId;

  const Swatches = ({ kinds, target }: { kinds: Material['kind'][]; target: 'walls' | 'floor' }) => (
    <div className="flex flex-wrap gap-1.5">
      {MATERIALS.filter((m) => kinds.includes(m.kind)).map((m) => {
        const on = current(target) === m.id;
        return (
          <button
            key={m.id}
            title={`${m.name} · ${m.brand}`}
            aria-label={m.name}
            aria-pressed={on}
            onClick={() => room && (on ? removeSurface(design.surfaces.find((s) => s.roomId === room.id && s.target === target)!.uid) : setSurface({ roomId: room.id, target, materialId: m.id }))}
            className={`h-8 w-8 rounded-md border shadow-swatch ${on ? 'ring-2 ring-ink ring-offset-1' : 'border-line'}`}
            style={{
              background:
                m.kind === 'wallpaper'
                  ? `repeating-linear-gradient(90deg, ${m.color} 0 6px, ${m.accent} 6px 8px)`
                  : m.kind === 'floor'
                    ? `repeating-linear-gradient(0deg, ${m.color} 0 7px, rgba(0,0,0,.12) 7px 8px)`
                    : m.color,
            }}
          />
        );
      })}
    </div>
  );

  return (
    <section className="rounded-2xl border border-line bg-card p-3">
      <h3 className="font-display text-base">Walls and floor</h3>
      {!room ? (
        <p className="mt-1 text-xs text-muted">Walk into a room to try paint, wallpaper or flooring.</p>
      ) : (
        <div className="mt-2 space-y-3">
          <div>
            <div className="eyebrow mb-1">Paint and wallpaper · all walls</div>
            <Swatches kinds={['paint', 'wallpaper']} target="walls" />
          </div>
          <div>
            <div className="eyebrow mb-1">Flooring</div>
            <Swatches kinds={['floor']} target="floor" />
          </div>
          {lines.length > 0 && (
            <ul className="space-y-1 border-t border-line pt-2 text-xs">
              {lines.map((l) => (
                <li key={l.s.uid} className="flex justify-between">
                  <span>
                    {l.m.name}: <span className="num">{l.qty} {l.unit}</span> <span className="text-muted">({Math.round(l.area)} sq ft)</span>
                  </span>
                  <span className="num">{fmtUsd(l.cost)}</span>
                </li>
              ))}
              <li className="text-[11px] text-muted">
                Wall area assumes {Math.round(15)}% windows and doorways; the scan doesn&apos;t mark openings. Paint is 2 coats; flooring adds 10% waste.
              </li>
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
