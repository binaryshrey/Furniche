'use client';
import { useState } from 'react';
import { senseRoom } from '@/lib/scanSense';
import { autoFurnish, furnishableType } from '@/lib/autofurnish';
import { useViewerState } from '@/lib/sceneBridge';
import { useDesign, useProducts, useStore } from '@/lib/store';
import type { ModelGeometry } from '@/lib/types';

const EXAMPLES = ['Warm Japandi under $3,000', 'Midcentury with walnut, $2,500', 'Bright coastal, keep it cheap'];

// onFurnished: the rooms that just got furniture, so the editor can show them off.
export default function StylistBox({ geometry, roomId, onFurnished }: { geometry: ModelGeometry | null; roomId: string | null; onFurnished?: (roomIds: string[]) => void }) {
  const room = geometry?.rooms.find((r) => r.id === roomId) ?? null;
  const design = useDesign();
  const imported = useStore((s) => s.importedProducts);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ summary: string; dropped: { name: string; reason: string }[]; method: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const products = useProducts();
  // A defurnished model's mesh still holds the seller's furniture, so its "fixtures" aren't fixed.
  const hasDefurnish = useViewerState((s) => s.hasDefurnish);
  const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // Instant starting layout: recommended pieces for the room's type and size, placed by trying
  // several layouts and keeping the best, in every furnishable room. Replaces only those rooms' pieces.
  function furnish() {
    if (!geometry) return;
    setError(null);
    const rooms = geometry.rooms.filter((r) => furnishableType(r));
    let pieces = 0;
    let spent = 0;
    let budget = 0;
    let done = 0;
    let tried = 0;
    const furnished: string[] = [];
    const dropped: { name: string; reason: string }[] = [];
    for (const r of rooms) {
      const sense = senseRoom(r, { fixtures: !hasDefurnish });
      const res = autoFurnish(r, products, { doors: design.doors, walls: geometry.walls, theme: design.themeId, rooms: geometry.rooms, panos: geometry.panos, sense });
      if (!res) continue;
      useStore.getState().replaceItems(res.placed.map((p) => ({ productId: p.productId, roomId: p.roomId, pos: p.pos, rot: p.rot })), r.id);
      pieces += res.placed.length;
      spent += res.spent;
      budget += res.budget;
      tried = Math.max(tried, res.tried);
      done += 1;
      furnished.push(r.id);
      dropped.push(...res.dropped.map((d) => ({ name: d.product.name.split(',')[0], reason: d.reason })));
    }
    if (!done) {
      setNote(null);
      return setError('No furnishable rooms found.');
    }
    // The whole home was refurnished: drop pieces stranded outside every room, then fix the new
    // layout in place so the rooms can be walked without nudging anything.
    useStore.getState().replaceItems([], null);
    useStore.getState().setLocked(true);
    setNote({
      summary: `${pieces} pieces in ${done} ${done === 1 ? 'room' : 'rooms'} for ${usd(spent)} (budget ${usd(budget)}). Compared ${tried} layouts per room and kept the one with the best fit, reading doorways, windows and built-ins from the scan and leaving every doorway and walking route clear.`,
      dropped,
      method: 'auto',
    });
    onFurnished?.(furnished);
  }

  async function run(text: string) {
    if (!room) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/stylist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, doors: design.doors, prompt: text, themeId: design.themeId, extraProducts: imported }),
      });
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? 'The stylist could not furnish this room.');
      useStore.getState().replaceItems(json.placed, room.id);
      if (json.themeId) useStore.getState().setTheme(json.themeId);
      setNote({ summary: json.summary, dropped: json.dropped, method: json.method });
      onFurnished?.([room.id]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-display text-base">Stylist</h3>
        <span className="text-[11px] text-muted">{room ? `${room.label} · ${room.widthM.toFixed(1)} × ${room.depthM.toFixed(1)} m` : 'Walk into a room'}</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) run(prompt);
        }}
        className="flex items-center gap-2 rounded-full border border-line bg-paper py-1 pl-3 pr-1"
      >
        <input
          id="stylist-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!room || busy}
          placeholder={room ? `Describe a look for this ${room.label.toLowerCase()}…` : 'Walk into a room to start'}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <button disabled={!room || busy || !prompt.trim()} className="rounded-full btn-brand px-3 py-1.5 text-xs  disabled:opacity-40">
          {busy ? 'Styling…' : 'Furnish'}
        </button>
      </form>
      <button
        onClick={furnish}
        disabled={!geometry}
        className="mt-2 w-full rounded-lg btn-brand px-2 py-2 text-xs font-semibold disabled:opacity-40"
      >
        Auto-furnish
      </button>
      {!note && room && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => (setPrompt(ex), run(ex))} disabled={busy} className="rounded-full border border-line px-2 py-0.5 text-[11px] hover:border-ink/40">
              {ex}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {note && (
        <div className="mt-2 space-y-1 text-xs">
          <p>{note.summary}</p>
          {note.dropped.length > 0 && (
            <p className="text-muted">
              Left out: {note.dropped.slice(0, 3).map((d) => `${d.name} (${d.reason.toLowerCase()})`).join('; ')}
              {note.dropped.length > 3 ? ` and ${note.dropped.length - 3} more` : ''}.
            </p>
          )}
          <p className="text-[11px] text-muted">
            {note.method === 'auto'
              ? 'Picked for the room’s type, size, style and budget, preferring pieces with real 3D models. Drag, rotate or remove anything.'
              : note.method === 'ai'
                ? 'Products chosen by AI; positions set by layout rules.'
                : 'Chosen by style and budget rules.'}{' '}
            Replaces what was in {note.method === 'auto' ? 'the furnished rooms' : 'this room'}.
          </p>
        </div>
      )}
    </section>
  );
}
