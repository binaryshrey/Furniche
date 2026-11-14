'use client';
import { useState } from 'react';
import { useDesign, useStore } from '@/lib/store';
import type { ModelGeometry } from '@/lib/types';

const EXAMPLES = ['Warm Japandi under $3,000', 'Midcentury with walnut, $2,500', 'Bright coastal, keep it cheap'];

export default function StylistBox({ geometry, roomId }: { geometry: ModelGeometry | null; roomId: string | null }) {
  const room = geometry?.rooms.find((r) => r.id === roomId) ?? null;
  const design = useDesign();
  const imported = useStore((s) => s.importedProducts);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ summary: string; dropped: { name: string; reason: string }[]; method: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

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
              Left out: {note.dropped.map((d) => `${d.name} (${d.reason.toLowerCase()})`).join('; ')}.
            </p>
          )}
          <p className="text-[11px] text-muted">{note.method === 'ai' ? 'Products chosen by AI; positions set by layout rules.' : 'Chosen by style and budget rules.'} Replaces what was in this room.</p>
        </div>
      )}
    </section>
  );
}
