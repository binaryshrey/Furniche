'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CategoryCarousel, CategoryGrid, FURNITURE_GROUPS } from '@/components/assistant/FurnitureCarousel';
import WallsFloorTab from '@/components/assistant/WallsFloorTab';
import { surfaceLines } from '@/components/design/SurfacesBox';
import MyDesignTab from '@/components/assistant/MyDesignTab';
import PhotoTo3D from '@/components/photo/PhotoTo3D';
import { fmtUsd } from '@/components/shop/ShopPanel';
import type { WorkDesign } from '@/lib/designOps';
import { useLighting, type LightPrefs } from '@/lib/lighting';
import { useViewerState } from '@/lib/sceneBridge';
import { autoFurnishAll } from '@/lib/autoFurnishAll';
import { roomScenes } from '@/lib/roomScenes';
import { lookAt } from '@/lib/showcase';
import { usePanel } from '@/lib/uiState';
import { useDesign, useStore } from '@/lib/store';
import type { Design, ModelGeometry, Product } from '@/lib/types';
import BudgetStrip, { useBudget } from './BudgetStrip';

// What the design looked like before a reply changed it, so one tap can put it back.
type Before = { design: Design; lighting: LightPrefs };
type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  channel: "web" | "imessage";
  from?: string;
  actions?: string[];
  suggestions?: string[];
  before?: Before | null;
  undone?: boolean;
};
type Tab = 'chat' | 'furniture' | 'photo' | 'finishes' | 'design';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z' },
  { id: 'furniture', label: 'Furniture', icon: 'M4 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 12h18v4H3zM5 16v2M19 16v2' },
  { id: 'photo', label: 'Photo to 3D', icon: 'M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z' },
  { id: 'finishes', label: 'Walls & floor', icon: 'M4 4h12v5H4zM16 6.5h3v5h-7v3M11 14.5h2v6h-2z' },
  { id: 'design', label: 'My design', icon: 'M4 6h16M4 12h16M4 18h10' },
];

const AUTO = "Auto-furnish every room";
const STARTERS = [
  AUTO,
  "What can I afford?",
  "Make this room feel bigger",
  "Warmer evening light",
];
const AUTO_RE =
  /\bauto[- ]?furnish|furnish (the )?(whole|entire|every|all)|furnish everything/i;
const SPARK =
  "M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z";

const mid = () => Math.random().toString(36).slice(2, 10);

function snapshot(geometry: ModelGeometry | null = null): { sid: string; roomId: string | null; design: WorkDesign; imported: ReturnType<typeof useStore.getState>['importedProducts']; lighting: LightPrefs; scenes: ReturnType<typeof roomScenes> } {
  const s = useStore.getState();
  const d = s.design();
  const { brightness, warmth } = useLighting.getState();
  return {
    sid: d.sid,
    roomId: useViewerState.getState().currentRoomId,
    design: {
      items: d.items,
      surfaces: d.surfaces,
      doors: d.doors,
      themeId: d.themeId,
    },
    imported: s.importedProducts,
    lighting: { brightness, warmth },
    scenes: roomScenes(geometry), // windows and built-ins, so the assistant places pieces clear of them
  };
}

// Apply a reply's edits; returns what to restore on Undo (null when nothing changed).
function apply(out: {
  design?: WorkDesign | null;
  lighting?: LightPrefs | null;
}): Before | null {
  if (!out.design && !out.lighting) return null;
  const cur = useStore.getState().design();
  const { brightness, warmth } = useLighting.getState();
  const before: Before = { design: cur, lighting: { brightness, warmth } };
  // Pieces the chat adds or moves stay movable.
  if (out.design)
    useStore.getState().loadDesign({
      ...cur,
      ...out.design,
      locked: false,
      updatedAt: new Date().toISOString(),
    });
  if (out.lighting) useLighting.getState().set(out.lighting);
  return before;
}

// Everything for furnishing the home lives behind one "Ask Furniche" button, so the 3D tour can
// fill the screen: chat (which edits the room and answers on iMessage via Photon), Auto-furnish
// and the stylist, a furniture carousel per category, walls and floor, and the design list.
export default function ChatPanel({
  geometry,
}: {
  geometry: ModelGeometry | null;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [photon, setPhoton] = useState(false);
  const [unread, setUnread] = useState(0);
  const [starters, setStarters] = useState<string[]>(STARTERS);
  const [seeAll, setSeeAll] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const design = useDesign();
  const roomId = useViewerState((s) => s.currentRoomId);
  const room = geometry?.rooms.find((r) => r.id === roomId) ?? null;
  const productOf = useStore((s) => s.product);
  // Furniture plus paint and flooring, for the move-in budget. Pieces from My Scans are the
  // mover's own, so they cost nothing here.
  const planned = useMemo(
    () =>
      design.items.reduce((s, i) => {
        const p = productOf(i.productId);
        return s + (p && p.source !== 'photo' ? p.priceUsd : 0);
      }, 0) + surfaceLines(geometry, design.surfaces, design.doors).reduce((s, f) => s + f.cost, 0),
    [design.items, design.surfaces, design.doors, geometry, productOf],
  );
  const budget = useBudget(planned, msgs.length);

  // Chat follows the newest message; every other tab opens at its top.
  useEffect(() => {
    if (tab === "chat")
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, [msgs, busy, tab]);
  useEffect(() => {
    if (tab !== "chat") listRef.current?.scrollTo({ top: 0 });
  }, [tab, seeAll]);

  useEffect(() => usePanel.getState().setOpen(open), [open]);

  // The phone remote (components/remote/PhoneRemote.tsx) talks to the chat through window events:
  // "fn-chat" sends a message as if typed here, "fn-frame" shows off the room you're in. Replies go
  // back out as "fn-chat-reply" so the phone can show them.
  const remoteRef = useRef({ send, frame });
  remoteRef.current = { send, frame };
  useEffect(() => {
    const onChat = (e: Event) => {
      const text = String((e as CustomEvent<string>).detail ?? '').trim();
      if (text) remoteRef.current.send(text);
    };
    const onFrame = () => {
      const r = useViewerState.getState().currentRoomId;
      if (r) remoteRef.current.frame(r);
    };
    window.addEventListener('fn-chat', onChat);
    window.addEventListener('fn-frame', onFrame);
    return () => {
      window.removeEventListener('fn-chat', onChat);
      window.removeEventListener('fn-frame', onFrame);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Opening chat options fit the room the shopper is standing in and what is already there.
  useEffect(() => {
    if (!open || msgs.length) return;
    const snap = snapshot(geometry);
    if (!snap.sid) return;
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...snap, suggestOnly: true }),
    })
      .then((r) => r.json())
      .then((j) => j.suggestions?.length && setStarters(j.suggestions))
      .catch(() => {});
  }, [open, msgs.length, roomId, design.items.length]);

  // iMessage bridge: poll while the editor is open.
  useEffect(() => {
    fetch("/api/photon/sync")
      .then((r) => r.json())
      .then((j) => setPhoton(!!j.enabled))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!photon) return;
    let alive = true;
    const tick = async () => {
      const snap = snapshot(geometry);
      if (!snap.sid) return;
      try {
        const res = await fetch("/api/photon/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap),
        });
        const j = await res.json();
        if (!alive || !j.events?.length) return;
        const before = apply(j);
        setMsgs((m) => [
          ...m,
          ...j.events.flatMap(
            (
              e: {
                from: string;
                text: string;
                reply: string;
                actions: string[];
                suggestions: string[];
              },
              k: number,
              all: unknown[],
            ) => [
              {
                id: mid(),
                role: "user" as const,
                text: e.text,
                channel: "imessage" as const,
                from: e.from,
              },
              {
                id: mid(),
                role: "assistant" as const,
                text: e.reply,
                channel: "imessage" as const,
                actions: e.actions,
                suggestions: e.suggestions,
                before: k === all.length - 1 ? before : null,
              },
            ],
          ),
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

  // Bring a room (or one piece) into view from where a visitor would stand. No spinning.
  async function frame(roomIdToShow: string, opts: { target?: { x: number; y: number }; back?: number; pitch?: number } = {}) {
    // Wait (up to 20 s) for the tour to be ready; moving the camera earlier is ignored. `ready`
    // counts too: on some homes `showingRoom` stays false after the boot has settled.
    const live = () => {
      const v = useViewerState.getState();
      return !!v.sdk && (v.showingRoom || v.ready);
    };
    for (let t = 0; t < 40 && !live(); t++) await new Promise((r) => setTimeout(r, 500));
    const sdk = useViewerState.getState().sdk;
    if (!geometry || !sdk) return;
    const { moveToPano } = await import("@/components/viewer/MatterportHost");
    // The open panel covers the right of the view, so aim a little right to keep the pieces in the clear part.
    await lookAt({ sdk, geometry, roomId: roomIdToShow, items: useStore.getState().design().items, moveToPano: (s, id) => moveToPano(s, id, true, 2), yawOffset: usePanel.getState().open ? 18 : 0, ...opts });
  }

  // Auto-furnish from the chat: furnish every room, report it like any reply (with Undo), then
  // move the camera to the furnished room you're in (or the fullest one) facing the new pieces.
  function runAutoFurnish(message: string) {
    if (!geometry) return;
    setTab("chat");
    const before: Before = {
      design: useStore.getState().design(),
      lighting: { ...useLighting.getState() },
    };
    const res = autoFurnishAll(geometry);
    const user: Msg = {
      id: mid(),
      role: "user",
      text: message,
      channel: "web",
    };
    if (!res) {
      setMsgs((m) => [
        ...m,
        user,
        {
          id: mid(),
          role: "assistant",
          text: "I could not find a room to furnish in this scan.",
          channel: "web",
        },
      ]);
      return;
    }
    const items = useStore.getState().design().items;
    const target = res.rooms.includes(roomId ?? "")
      ? roomId!
      : [...res.rooms].sort(
          (a, b) =>
            items.filter((i) => i.roomId === b).length -
            items.filter((i) => i.roomId === a).length,
        )[0];
    const label =
      geometry.rooms.find((r) => r.id === target)?.label.toLowerCase() ??
      "room";
    const text = `${res.summary}${res.dropped.length ? ` Left out to keep the rooms open: ${res.dropped.slice(0, 3).join(", ")}${res.dropped.length > 3 ? ` and ${res.dropped.length - 3} more` : ""}.` : ""} Showing you the ${label}.`;
    setMsgs((m) => [
      ...m,
      user,
      {
        id: mid(),
        role: "assistant",
        text,
        channel: "web",
        actions: res.rooms.map(
          (id) =>
            `Furnished ${geometry.rooms.find((r) => r.id === id)?.label ?? "room"}`,
        ),
        suggestions: [
          "What can I afford?",
          "Make this room feel bigger",
          `Paint the walls to match`,
          "Swap the sofa for something cheaper",
        ],
        before,
      },
    ]);
    window.dispatchEvent(new CustomEvent('fn-chat-reply', { detail: { text, suggestions: ['What can I afford?', 'Make this room feel bigger', 'Warmer evening light'] } }));
    frame(target);
  }

  async function send(message: string) {
    if (!message.trim() || busy) return;
    if (AUTO_RE.test(message)) {
      setText("");
      return runAutoFurnish(message);
    }
    setTab("chat");
    const history = msgs
      .filter((m) => m.channel === "web")
      .map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [
      ...m,
      { id: mid(), role: "user", text: message, channel: "web" },
    ]);
    setText("");
    setBusy(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot(geometry), history, message }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "The assistant is unavailable.");
      const before = apply(j);
      window.dispatchEvent(new CustomEvent('fn-chat-reply', { detail: { text: j.reply, suggestions: j.suggestions ?? [] } }));
      setMsgs((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: j.reply,
          channel: "web",
          actions: j.actions,
          suggestions: j.suggestions,
          before,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          id: mid(),
          role: "assistant",
          text: (e as Error).message,
          channel: "web",
          suggestions: ["Try again"],
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function undo(msg: Msg) {
    if (!msg.before) return;
    useStore.getState().loadDesign({
      ...msg.before.design,
      updatedAt: new Date().toISOString(),
    });
    useLighting.getState().set(msg.before.lighting);
    setMsgs((m) => [
      ...m.map((x) => (x.id === msg.id ? { ...x, undone: true } : x)),
      {
        id: mid(),
        role: "assistant",
        text: "Undone. The room is back to how it was.",
        channel: "web",
        suggestions: msg.suggestions,
      },
    ]);
  }

  function added(p: Product, placed: boolean) {
    // Added pieces are always movable: unlock the furniture; the new piece is already selected.
    const st = useStore.getState();
    st.setLocked(false);
    const name = p.name.split(',')[0];
    if (placed) {
      setToast(`${name} added. Drag it to move, drag ↻ to rotate`);
      // Log it in the chat too, with a one-tap Remove (and Undo, which restores the design without it).
      const cur = st.design();
      const before: Before = { design: { ...cur, items: cur.items.filter((i) => i.uid !== st.selectedUid) }, lighting: { ...useLighting.getState() } };
      setMsgs((m) => [
        ...m,
        { id: mid(), role: 'assistant', text: `Added the ${name} (${fmtUsd(p.priceUsd)}) to the ${room?.label.toLowerCase() ?? 'room'}, clear of walkways and windows.`, channel: 'web', actions: [`Added ${name}`], suggestions: [`Remove the ${name}`, 'Make this room feel bigger', 'What can I afford?'], before },
      ]);
    } else {
      setToast(`Click the floor where the ${p.name.split(',')[0]} should go`);
      setOpen(false);
    }
  }

  // Picking a piece in My design selects it and brings it into view.
  function focusPiece(uid: string) {
    const it = useStore.getState().design().items.find((i) => i.uid === uid);
    // A little further back, with the piece a touch above centre so the swap card doesn't hide it.
    if (it?.roomId) frame(it.roomId, { target: { x: it.pos.x, y: it.pos.y }, back: 2.3, pitch: 4 });
  }

  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const lastUser = [...msgs].reverse().find((m) => m.role === "user");

  const Chip = ({
    label,
    onClick,
    tone,
  }: {
    label: string;
    onClick: () => void;
    tone?: "undo";
  }) => (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-full border px-2.5 py-1 text-left text-[11px] leading-tight transition disabled:opacity-40 ${
        tone === "undo"
          ? "border-line text-muted hover:text-ink"
          : "border-brand/50 bg-brand/10 text-ink hover:bg-brand/20"
      }`}
    >
      {tone === "undo" ? "↶ " : ""}
      {label}
    </button>
  );

  const group = FURNITURE_GROUPS.find((g) => g.id === seeAll) ?? null;

  return (
    <>
      {!open && (
        <button
          data-fn-ui
          onClick={() => (setOpen(true), setUnread(0))}
          className="absolute right-4 top-4 z-40 flex items-center gap-2 rounded-full btn-brand px-4 py-2.5 text-sm font-semibold shadow-swatch"
          aria-label="Open Ask FurNiche AI"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
          </svg>
          Ask FurNiche AI
          {design.items.length > 0 && <span className="num rounded-full bg-black/25 px-2 py-0.5 text-[11px]">{fmtUsd(planned)}</span>}
          {unread > 0 && <span className="rounded-full bg-white px-1.5 text-[11px] text-brand">{unread}</span>}
        </button>
      )}

      {toast && (
        <div
          data-fn-ui
          className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-medium text-paper shadow-swatch"
        >
          {toast}
        </div>
      )}

      {open && (
        <section data-fn-ui className="absolute bottom-3 right-3 top-3 z-40 flex w-[440px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-paper/55 shadow-swatch backdrop-blur-[2px] [text-shadow:0_1px_2px_rgba(0,0,0,.45)]" aria-label="Ask FurNiche AI">
          <header className="flex items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="font-display text-base font-semibold">Ask FurNiche AI</h2>
            {photon && <span className="rounded-full bg-ok/15 px-2 py-0.5 text-[10px] text-ok">iMessage on</span>}
            <span className="ml-auto text-[11px] text-muted">{room ? `${room.label} · ${room.widthM.toFixed(1)} × ${room.depthM.toFixed(1)} m` : 'Walk into a room'}</span>
            <button onClick={() => setOpen(false)} className="rounded px-1.5 text-muted hover:text-ink" aria-label="Close Ask FurNiche AI">
              ✕
            </button>
          </header>
          <BudgetStrip budget={budget} planned={planned} />

          <nav className="grid grid-cols-4 border-b border-line" role="tablist" aria-label="Ask FurNiche AI sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => (setTab(t.id), setSeeAll(null))}
                className={`flex flex-col items-center gap-1 px-1 py-2 text-[10px] transition ${tab === t.id ? "border-b-2 border-brand text-ink" : "border-b-2 border-transparent text-muted hover:text-ink"}`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d={t.icon} />
                </svg>
                {t.label}
              </button>
            ))}
          </nav>

          <div
            ref={listRef}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4"
          >
            {tab === "chat" && (
              <div className="space-y-2">
                <button
                  onClick={() => runAutoFurnish(AUTO)}
                  disabled={!geometry}
                  className="flex w-full items-center justify-center gap-2 rounded-xl btn-brand px-3 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d={SPARK} />
                  </svg>
                  Auto-furnish every room
                </button>
                {msgs.length === 0 && (
                  <p className="text-xs text-muted">
                    Tell me what to change and I’ll do it in the room: add or
                    swap pieces, paint, flooring, lighting, more open space, or
                    fit it all within your Capital One budget.
                    {photon && " You can also text me on iMessage."}
                  </p>
                )}
                {msgs.map((m) => (
                  <div
                    key={m.id}
                    className={m.role === "user" ? "flex justify-end" : ""}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-brand text-white" : "bg-card/75"} ${m.undone ? "opacity-60" : ""}`}
                    >
                      {m.channel === "imessage" && (
                        <div
                          className={`mb-0.5 text-[10px] ${m.role === "user" ? "text-white/80" : "text-muted"}`}
                        >
                          {m.role === "user"
                            ? `iMessage · ${m.from}`
                            : "Replied on iMessage"}
                        </div>
                      )}
                      <p className="whitespace-pre-wrap">{m.text}</p>
                      {!!m.actions?.length && (
                        <ul className="mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px] text-ok">
                          {m.actions.map((a, i) => (
                            <li
                              key={i}
                              className={m.undone ? "line-through" : ""}
                            >
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
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />{" "}
                    Working on it…
                  </div>
                )}
              </div>
            )}

            {tab === "furniture" &&
              (group ? (
                <CategoryGrid
                  group={group}
                  room={room}
                  geometry={geometry}
                  onBack={() => setSeeAll(null)}
                  onAdded={added}
                />
              ) : (
                <div className="space-y-3">
                  {!room && (
                    <p className="rounded-xl border border-dashed border-line p-3 text-xs text-muted">
                      Walk into a room and pieces are placed for you. Until
                      then, pick a piece and click the floor where it goes.
                    </p>
                  )}
                  {FURNITURE_GROUPS.map((g) => (
                    <CategoryCarousel
                      key={g.id}
                      group={g}
                      room={room}
                      geometry={geometry}
                      onSeeAll={() => setSeeAll(g.id)}
                      onAdded={added}
                    />
                  ))}
                </div>
              ))}

            {/* Kept mounted so a build in progress, or a finished preview, survives switching tabs. */}
            <div className={tab === 'photo' ? '' : 'hidden'}>
              <PhotoTo3D room={room} geometry={geometry} onAdded={added} />
            </div>

            {tab === 'finishes' && <WallsFloorTab geometry={geometry} room={room} />}

            {tab === 'design' && <MyDesignTab geometry={geometry} budget={budget} onFocus={focusPiece} onAutoFurnish={() => runAutoFurnish(AUTO)} onBrowse={() => setTab('furniture')} />}
          </div>

          {tab === "chat" && (
            <>
              <div
                className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2"
                aria-label="Suggested next steps"
              >
                {lastAssistant?.before && !lastAssistant.undone && (
                  <Chip
                    label="Undo"
                    tone="undo"
                    onClick={() => undo(lastAssistant)}
                  />
                )}
                {(() => {
                  const list = lastAssistant?.suggestions?.length
                    ? lastAssistant.suggestions
                    : starters;
                  return design.items.length || list.includes(AUTO)
                    ? list
                    : [AUTO, ...list].slice(0, 4);
                })().map((s) => (
                  <Chip
                    key={s}
                    label={s}
                    onClick={() =>
                      send(s === "Try again" && lastUser ? lastUser.text : s)
                    }
                  />
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
                <button
                  disabled={busy || !text.trim()}
                  className="rounded-full btn-brand px-3 py-2 text-xs font-semibold disabled:opacity-40"
                >
                  Send
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
