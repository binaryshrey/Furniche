'use client';
import { useEffect, useState } from 'react';
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
export default function WallsFloorTab({ geometry, room: here }: { geometry: ModelGeometry | null; room: Room | null }) {
  const design = useDesign();
  const { setSurface, removeSurface, setTheme } = useStore.getState();
  // Any room can be finished, not only the one the camera is in: follow the camera by default,
  // and let the picker choose another (or one while the tour is still loading).
  const rooms = (geometry?.rooms ?? []).filter((r) => r.areaM2 > 4 && !/closet|void/i.test(r.label));
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => setPicked(null), [here?.id]);
  const room = rooms.find((r) => r.id === picked) ?? here ?? rooms[0] ?? null;

  if (!room) return <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-muted">Loading the rooms of this home…</p>;

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
      <div className="flex items-center justify-between gap-2">
        <h3 className="sr-only">{room.label}</h3>
        <select
          id="finish-room"
          aria-label="Room to finish"
          value={room.id}
          onChange={(e) => setPicked(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-paper/60 px-2.5 py-1.5 font-display text-base font-semibold"
        >
          {rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} · {r.areaM2.toFixed(0)} m²{r.id === here?.id ? ' (you are here)' : ''}
            </option>
          ))}
        </select>
        <span className="shrink-0 text-xs text-muted">
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
        <section className="rounded-xl border border-white/10 bg-paper/50 p-3 text-xs">
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
