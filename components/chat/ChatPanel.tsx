'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkDesign } from '@/lib/designOps';
import { useLighting, type LightPrefs } from '@/lib/lighting';
import { useViewerState } from '@/lib/sceneBridge';
import { useDesign, useStore } from '@/lib/store';
import type { Design } from '@/lib/types';
import BudgetStrip, { useBudget } from './BudgetStrip';

// What the design looked like before a reply changed it, so one tap can put it back.
type Before = { design: Design; lighting: LightPrefs };
type Msg = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  channel: 'web' | 'imessage';
  from?: string;
  actions?: string[];
  suggestions?: string[];
  before?: Before | null;
  undone?: boolean;
};

const STARTERS = ['What can I afford?', 'Furnish this room under $2,500', 'Make this room feel bigger', 'Warmer evening light'];

const mid = () => Math.random().toString(36).slice(2, 10);

function snapshot(): { sid: string; roomId: string | null; design: WorkDesign; imported: ReturnType<typeof useStore.getState>['importedProducts']; lighting: LightPrefs } {
  const s = useStore.getState();
  const d = s.design();
  const { brightness, warmth } = useLighting.getState();
  return {
    sid: d.sid,
    roomId: useViewerState.getState().currentRoomId,
    design: { items: d.items, surfaces: d.surfaces, doors: d.doors, themeId: d.themeId },
    imported: s.importedProducts,
    lighting: { brightness, warmth },
  };
}

// Apply a reply's edits; returns what to restore on Undo (null when nothing changed).
function apply(out: { design?: WorkDesign | null; lighting?: LightPrefs | null }): Before | null {
  if (!out.design && !out.lighting) return null;
  const cur = useStore.getState().design();
  const { brightness, warmth } = useLighting.getState();
  const before: Before = { design: cur, lighting: { brightness, warmth } };
  if (out.design) useStore.getState().loadDesign({ ...cur, ...out.design, updatedAt: new Date().toISOString() });
  if (out.lighting) useLighting.getState().set(out.lighting);
  return before;
}

// Chat with the Furniche agent about the open home. Every reply carries out the request, lists
// what changed, and offers next steps as one-tap options (plus Undo). The same agent answers
// iMessages through Photon; those conversations appear here too and edit the room live.
export default function ChatPanel() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [photon, setPhoton] = useState(false);
  const [unread, setUnread] = useState(0);
  const [starters, setStarters] = useState<string[]>(STARTERS);
  const listRef = useRef<HTMLDivElement>(null);
  const design = useDesign();
  const roomId = useViewerState((s) => s.currentRoomId);
  const productOf = useStore((s) => s.product);
  const planned = useMemo(() => design.items.reduce((s, i) => s + (productOf(i.productId)?.priceUsd ?? 0), 0), [design.items, productOf]);
  const budget = useBudget(planned, msgs.length);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  // Opening options fit the room the shopper is standing in and what is already there.
  useEffect(() => {
    if (!open || msgs.length) return;
    const snap = snapshot();
    if (!snap.sid) return;
    fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...snap, suggestOnly: true }) })
      .then((r) => r.json())
      .then((j) => j.suggestions?.length && setStarters(j.suggestions))
      .catch(() => {});
  }, [open, msgs.length, roomId, design.items.length]);

  // iMessage bridge: poll while the editor is open.
  useEffect(() => {
    fetch('/api/photon/sync')
      .then((r) => r.json())
      .then((j) => setPhoton(!!j.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!photon) return;
    let alive = true;
    const tick = async () => {
      const snap = snapshot();
      if (!snap.sid) return;
      try {
        const res = await fetch('/api/photon/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snap) });
        const j = await res.json();
        if (!alive || !j.events?.length) return;
        const before = apply(j);
        setMsgs((m) => [
          ...m,
          ...j.events.flatMap((e: { from: string; text: string; reply: string; actions: string[]; suggestions: string[] }, k: number, all: unknown[]) => [
            { id: mid(), role: 'user' as const, text: e.text, channel: 'imessage' as const, from: e.from },
            { id: mid(), role: 'assistant' as const, text: e.reply, channel: 'imessage' as const, actions: e.actions, suggestions: e.suggestions, before: k === all.length - 1 ? before : null },
          ]),
        ]);
        setUnread((u) => u + j.events.length);
      } catch {
        /* try again next tick */
      }
    };
    const t = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [photon]);

  async function send(message: string) {
    if (!message.trim() || busy) return;
    const history = msgs.filter((m) => m.channel === 'web').map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { id: mid(), role: 'user', text: message, channel: 'web' }]);
    setText('');
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot(), history, message }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'The assistant is unavailable.');
      const before = apply(j);
      setMsgs((m) => [...m, { id: mid(), role: 'assistant', text: j.reply, channel: 'web', actions: j.actions, suggestions: j.suggestions, before }]);
    } catch (e) {
      setMsgs((m) => [...m, { id: mid(), role: 'assistant', text: (e as Error).message, channel: 'web', suggestions: ['Try again'] }]);
    } finally {
      setBusy(false);
    }
  }

  function undo(msg: Msg) {
    if (!msg.before) return;
    useStore.getState().loadDesign({ ...msg.before.design, updatedAt: new Date().toISOString() });
    useLighting.getState().set(msg.before.lighting);
    setMsgs((m) => [...m.map((x) => (x.id === msg.id ? { ...x, undone: true } : x)), { id: mid(), role: 'assistant', text: 'Undone. The room is back to how it was.', channel: 'web', suggestions: msg.suggestions }]);
  }

  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user');

  if (!open) {
    return (
      <button
        onClick={() => (setOpen(true), setUnread(0))}
        className="absolute right-4 top-4 z-40 flex items-center gap-2 rounded-full btn-brand px-4 py-2.5 text-sm font-semibold shadow-swatch"
        aria-label="Open the design assistant"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        Ask Furniche
        {unread > 0 && <span className="rounded-full bg-white px-1.5 text-[11px] text-brand">{unread}</span>}
      </button>
    );
  }

  const Chip = ({ label, onClick, tone }: { label: string; onClick: () => void; tone?: 'undo' }) => (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-full border px-2.5 py-1 text-left text-[11px] leading-tight transition disabled:opacity-40 ${
        tone === 'undo' ? 'border-line text-muted hover:text-ink' : 'border-brand/50 bg-brand/10 text-ink hover:bg-brand/20'
      }`}
    >
      {tone === 'undo' ? '↶ ' : ''}
      {label}
    </button>
  );

  return (
    <section className="absolute bottom-16 right-4 top-4 z-40 flex w-[400px] max-w-[calc(100%-2rem)] flex-col overflow-hidden rounded-2xl border border-line bg-paper/95 shadow-swatch backdrop-blur" aria-label="Design assistant">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="font-display text-sm font-semibold">Ask Furniche</h2>
        {photon && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] text-ok">iMessage connected</span>}
        <button onClick={() => setOpen(false)} className="ml-auto rounded px-2 py-0.5 text-muted hover:text-ink" aria-label="Close the assistant">
          ✕
        </button>
      </header>
      <BudgetStrip budget={budget} planned={planned} />

      <div ref={listRef} className="scroll-thin min-h-[180px] flex-1 space-y-2 overflow-y-auto p-3">
        {msgs.length === 0 && (
          <p className="text-xs text-muted">
            Tell me what to change and I’ll do it in the room: add or swap pieces, paint, flooring, lighting, more open space, or fit it all within your Capital One budget.
            {photon && ' You can also text me on iMessage.'}
          </p>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-brand text-white' : 'bg-card'} ${m.undone ? 'opacity-60' : ''}`}>
              {m.channel === 'imessage' && <div className={`mb-0.5 text-[10px] ${m.role === 'user' ? 'text-white/80' : 'text-muted'}`}>{m.role === 'user' ? `iMessage · ${m.from}` : 'Replied on iMessage'}</div>}
              <p className="whitespace-pre-wrap">{m.text}</p>
              {!!m.actions?.length && (
                <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px] text-ok">
                  {m.actions.map((a, i) => (
                    <li key={i} className={m.undone ? 'line-through' : ''}>
                      ✓ {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" /> Working on it…
          </div>
        )}
      </div>

      {/* Next steps: always one tap away, refreshed after every reply. */}
      <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2" aria-label="Suggested next steps">
        {lastAssistant?.before && !lastAssistant.undone && <Chip label="Undo" tone="undo" onClick={() => undo(lastAssistant)} />}
        {(lastAssistant?.suggestions?.length ? lastAssistant.suggestions : starters).map((s) => (
          <Chip key={s} label={s} onClick={() => send(s === 'Try again' && lastUser ? lastUser.text : s)} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex items-center gap-2 border-t border-line p-2"
      >
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. add two armchairs and a jute rug"
          className="min-w-0 flex-1 rounded-full border border-line bg-card px-3 py-2 text-sm outline-none focus:border-ink/40"
          disabled={busy}
        />
        <button disabled={busy || !text.trim()} className="rounded-full btn-brand px-3 py-2 text-xs font-semibold disabled:opacity-40">
          Send
        </button>
      </form>
    </section>
  );
}
