'use client';
import { MATERIALS, materialById, type Material } from '@/catalog/materials';
import { THEMES } from '@/catalog/themes';
import { surfaceLines } from '@/components/design/SurfacesBox';
import { fmtUsd } from '@/components/shop/ShopPanel';
import { useDesign, useStore } from '@/lib/store';
import type { ModelGeometry, Room } from '@/lib/types';

const swatchBg = (m: Material) =>
  m.kind === 'wallpaper'
    ? `repeating-linear-gradient(90deg, ${m.color} 0 6px, ${m.accent} 6px 8px)`
    : m.kind === 'floor'
      ? `repeating-linear-gradient(0deg, ${m.color} 0 7px, rgba(0,0,0,.14) 7px 8px)`
      : m.color;

// Paint, wallpaper and flooring for the room you're standing in: one-tap theme looks first,
// then every finish with its name and price, then quantities and cost.
export default function WallsFloorTab({ geometry, room }: { geometry: ModelGeometry | null; room: Room | null }) {
  const design = useDesign();
  const { setSurface, removeSurface, setTheme } = useStore.getState();

  if (!room) return <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">Walk into a room to try paint, wallpaper and flooring.</p>;

  const current = (target: 'walls' | 'floor') => design.surfaces.find((s) => s.roomId === room.id && s.target === target);
  const toggle = (target: 'walls' | 'floor', m: Material) => {
    const cur = current(target);
    if (cur?.materialId === m.id) removeSurface(cur.uid);
    else setSurface({ roomId: room.id, target, materialId: m.id });
  };
  const lines = surfaceLines(geometry, design.surfaces, design.doors).filter((l) => l.room.id === room.id);

  const Group = ({ title, kinds, target }: { title: string; kinds: Material['kind'][]; target: 'walls' | 'floor' }) => (
    <section>
      <h4 className="eyebrow mb-2">{title}</h4>
      <div className="grid grid-cols-4 gap-2">
        {MATERIALS.filter((m) => kinds.includes(m.kind)).map((m) => {
          const on = current(target)?.materialId === m.id;
          return (
            <button key={m.id} onClick={() => toggle(target, m)} aria-pressed={on} className="group text-left">
              <span className={`block h-12 rounded-lg border shadow-swatch transition ${on ? 'ring-2 ring-brand ring-offset-2 ring-offset-card' : 'border-line group-hover:border-ink/40'}`} style={{ background: swatchBg(m) }} />
              <span className="mt-1 block truncate text-[11px] leading-tight">{m.name}</span>
              <span className="num block text-[10px] text-muted">
                {fmtUsd(m.priceUsd)}/{m.unit}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg font-semibold">{room.label}</h3>
        <span className="text-xs text-muted">
          {room.widthM.toFixed(1)} × {room.depthM.toFixed(1)} m
        </span>
      </div>

      <section>
        <h4 className="eyebrow mb-2">Match a look · walls and floor together</h4>
        <div className="grid grid-cols-2 gap-2">
          {THEMES.map((t) => {
            const on = current('walls')?.materialId === t.wallPaint && current('floor')?.materialId === t.floor;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSurface({ roomId: room.id, target: 'walls', materialId: t.wallPaint });
                  setSurface({ roomId: room.id, target: 'floor', materialId: t.floor });
                  setTheme(t.id);
                }}
                className={`rounded-xl border p-2 text-left transition ${on ? 'border-brand bg-brand/10' : 'border-line hover:border-ink/40'}`}
              >
                <div className="flex gap-1">
                  {t.palette.map((c) => (
                    <span key={c} className="h-4 flex-1 rounded" style={{ background: c }} />
                  ))}
                </div>
                <div className="mt-1.5 text-xs font-medium">{t.name}</div>
                <div className="truncate text-[10px] text-muted">
                  {materialById(t.wallPaint)?.name} · {materialById(t.floor)?.name}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <Group title="Paint · all walls" kinds={['paint']} target="walls" />
      <Group title="Wallpaper" kinds={['wallpaper']} target="walls" />
      <Group title="Flooring" kinds={['floor']} target="floor" />

      {lines.length > 0 && (
        <section className="rounded-xl border border-line bg-paper p-3 text-xs">
          <h4 className="eyebrow mb-1.5">What to buy</h4>
          <ul className="space-y-1">
            {lines.map((l) => (
              <li key={l.s.uid} className="flex justify-between gap-2">
                <span>
                  {l.m.name}: <span className="num">{l.qty} {l.unit}</span> <span className="text-muted">({Math.round(l.area)} sq ft)</span>
                </span>
                <span className="num">{fmtUsd(l.cost)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-muted">Paint is 2 coats with 15% left for windows and doors; flooring adds 10% waste.</p>
        </section>
      )}
    </div>
  );
}
