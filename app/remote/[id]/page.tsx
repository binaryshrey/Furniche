'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type RemoteState = {
  title: string;
  rooms: { id: string; label: string; area: number }[];
  roomId: string | null;
  light: 'evening' | 'daylight' | 'neutral' | 'custom';
  total: number;
  pieces: number;
  showFurnished: boolean;
  hasDefurnish: boolean;
  ready: boolean;
  reply: string | null;
  suggestions: string[];
};

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const DEG_PER_PX = 0.35; // how far the view turns per pixel dragged on the look pad

// Defined outside the page so its buttons survive the once-a-second state refresh (a component
// declared inside would remount every render and could drop a tap).
function Btn({ children, onClick, active, wide, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; wide?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex items-center justify-center gap-1.5 rounded-2xl px-3 py-3 text-sm font-semibold transition active:scale-[0.97] ${wide ? 'col-span-2' : ''} ${active ? 'bg-[#ff385c] text-white' : 'bg-[#1b1b1b] text-[#f7f7f7]'}`}
    >
      {children}
    </button>
  );
}

// The phone side of the remote: opened from the QR code on the big screen. Every control posts a
// command the screen carries out at once; the screen's state is polled so buttons match it.
export default function Remote({ params }: { params: { id: string } }) {
  const id = params.id;
  const [state, setState] = useState<RemoteState | null>(null);
  const [screen, setScreen] = useState<'connecting' | 'on' | 'off'>('connecting');
  const [text, setText] = useState('');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [tilt, setTilt] = useState<'off' | 'on' | 'blocked'>('off');
  const lastReply = useRef<string | null>(null);

  const send = useCallback(
    (command: Record<string, unknown>) =>
      fetch(`/api/remote/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) })
        .then((r) => r.json())
        .then((j) => setScreen(j.delivered ? 'on' : 'off'))
        .catch(() => setScreen('off')),
    [id],
  );

  // Say hello, then keep the screen's state fresh.
  useEffect(() => {
    send({ type: 'hello' });
    let alive = true;
    const poll = () =>
      fetch(`/api/remote/${id}?from=phone`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return;
          setScreen(j.screenConnected ? 'on' : 'off');
          if (j.state) setState(j.state);
        })
        .catch(() => alive && setScreen('off'));
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, send]);

  // A new reply arrived for what we asked: stop the "thinking" note.
  useEffect(() => {
    if (state?.reply && state.reply !== lastReply.current) {
      lastReply.current = state.reply;
      setSentAt(null);
    }
  }, [state?.reply]);

  // Look pad: drag to turn the view; deltas are batched so a fast swipe is one smooth turn.
  const acc = useRef({ dx: 0, dy: 0 });
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const { dx, dy } = acc.current;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      acc.current = { dx: 0, dy: 0 };
      send({ type: 'look', dx, dy });
    }, 90);
    return () => clearInterval(t);
  }, [send]);

  // Tilt to look: turn the phone and the view follows (needs motion access; iPhone asks first).
  const prev = useRef<{ a: number; b: number } | null>(null);
  useEffect(() => {
    if (tilt !== 'on') return;
    let got = false;
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.alpha == null || e.beta == null) return;
      got = true;
      const cur = { a: e.alpha, b: e.beta };
      if (prev.current) {
        let da = cur.a - prev.current.a;
        if (da > 180) da -= 360;
        if (da < -180) da += 360;
        acc.current.dx += -da; // turning the phone left (alpha up) looks left
        acc.current.dy += (cur.b - prev.current.b) * 0.8;
      }
      prev.current = cur;
    };
    window.addEventListener('deviceorientation', onOrient);
    const check = setTimeout(() => !got && setTilt('blocked'), 2000);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      clearTimeout(check);
      prev.current = null;
    };
  }, [tilt]);

  async function toggleTilt() {
    if (tilt === 'on') return setTilt('off');
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    try {
      if (DOE?.requestPermission && (await DOE.requestPermission()) !== 'granted') return setTilt('blocked');
    } catch {
      return setTilt('blocked');
    }
    setTilt('on');
  }

  function chat(msg: string) {
    const m = msg.trim();
    if (!m) return;
    send({ type: 'chat', text: m });
    setText('');
    setSentAt(Date.now());
  }

  const room = state?.rooms.find((r) => r.id === state.roomId);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-4 bg-[#0f0f0f] px-4 pb-8 pt-4 text-[#f7f7f7]" style={{ touchAction: 'manipulation' }}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#ff385c]">FurNiche AI remote</div>
          <h1 className="truncate text-lg font-semibold">{state?.title ?? 'Connecting…'}</h1>
          <p className="text-xs text-[#a3a3a3]">
            {room ? `${room.label} · ${room.area} m²` : 'Walking the home'}
            {state && state.pieces > 0 ? ` · ${state.pieces} pieces · ${usd(state.total)}` : ''}
          </p>
        </div>
        <span className={`mt-1 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${screen === 'on' ? 'bg-[#6cc08a]/15 text-[#6cc08a]' : screen === 'off' ? 'bg-[#ea6a58]/15 text-[#ea6a58]' : 'bg-white/10 text-[#a3a3a3]'}`}>
          {screen === 'on' ? '● Screen connected' : screen === 'off' ? 'Screen offline' : 'Connecting…'}
        </span>
      </header>

      {screen === 'off' && (
        <p className="rounded-xl bg-[#ea6a58]/10 p-3 text-xs text-[#ea6a58]">The screen isn’t listening. Keep the home open on the computer and press Phone remote there.</p>
      )}

      {/* Look pad */}
      <section
        className="relative grid h-56 select-none place-items-center overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_50%_40%,#2a2a2a,#151515)]"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!last.current) return;
          acc.current.dx += (e.clientX - last.current.x) * DEG_PER_PX * -1; // drag like grabbing the scene
          acc.current.dy += (e.clientY - last.current.y) * DEG_PER_PX;
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (last.current = null)}
        onPointerCancel={() => (last.current = null)}
        aria-label="Drag to look around"
      >
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#a3a3a3" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 2v5M12 17v5M2 12h5M17 12h5" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="absolute bottom-3 text-xs text-[#a3a3a3]">Drag to look around</span>
        <button
          onClick={(e) => (e.stopPropagation(), toggleTilt())}
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute right-3 top-3 rounded-full px-3 py-1.5 text-[11px] font-semibold ${tilt === 'on' ? 'bg-[#ff385c] text-white' : 'bg-white/10 text-[#f7f7f7]'}`}
        >
          {tilt === 'on' ? 'Tilt on' : tilt === 'blocked' ? 'Tilt unavailable' : 'Tilt to look'}
        </button>
      </section>
      {tilt === 'blocked' && <p className="-mt-2 text-[11px] text-[#a3a3a3]">This browser didn’t share motion. On iPhone, motion needs a secure (https) page; the drag pad works everywhere.</p>}

      <section className="grid grid-cols-4 gap-2">
        <Btn onClick={() => send({ type: 'look', dx: -45, dy: 0 })} label="Turn left">
          ↺
        </Btn>
        <Btn onClick={() => send({ type: 'step', dir: 'forward' })} wide label="Step forward">
          ↑ Step forward
        </Btn>
        <Btn onClick={() => send({ type: 'look', dx: 45, dy: 0 })} label="Turn right">
          ↻
        </Btn>
        <Btn onClick={() => send({ type: 'look', dx: 0, dy: 15 })} label="Look up">
          ⌃
        </Btn>
        <Btn onClick={() => send({ type: 'step', dir: 'back' })} wide label="Step back">
          ↓ Step back
        </Btn>
        <Btn onClick={() => send({ type: 'look', dx: 0, dy: -15 })} label="Look down">
          ⌄
        </Btn>
      </section>

      {state && state.rooms.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#a3a3a3]">Go to room</h2>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {state.rooms.map((r) => (
              <button
                key={r.id}
                onClick={() => send({ type: 'room', id: r.id })}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm ${r.id === state.roomId ? 'bg-[#f7f7f7] font-semibold text-[#0f0f0f]' : 'bg-[#1b1b1b]'}`}
              >
                {r.label} <span className="text-xs opacity-60">{r.area} m²</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#a3a3a3]">Light</h2>
        <div className="grid grid-cols-3 gap-2">
          {(['evening', 'neutral', 'daylight'] as const).map((p) => (
            <Btn key={p} onClick={() => send({ type: 'light', preset: p })} active={state?.light === p}>
              {p === 'evening' ? '🌆 Evening' : p === 'daylight' ? '☀️ Daylight' : 'Neutral'}
            </Btn>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Btn onClick={() => chat('Auto-furnish every room')} active>
          ✨ Auto-furnish
        </Btn>
        <Btn onClick={() => send({ type: 'frame' })}>Show me the room</Btn>
        {state?.hasDefurnish && (
          <Btn onClick={() => send({ type: 'furnished', on: !state.showFurnished })} wide>
            {state.showFurnished ? 'Hide' : 'Show'} the seller’s furniture
          </Btn>
        )}
      </section>

      <section className="rounded-3xl border border-white/10 bg-[#151515] p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#a3a3a3]">Ask FurNiche AI</h2>
        {state?.reply && <p className="mb-2 rounded-2xl bg-[#1b1b1b] p-3 text-sm leading-snug">{state.reply}</p>}
        {sentAt && <p className="mb-2 text-xs text-[#a3a3a3]">Working on it…</p>}
        {state && state.suggestions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {state.suggestions.slice(0, 4).map((s) => (
              <button key={s} onClick={() => chat(s)} className="rounded-full border border-[#ff385c]/50 bg-[#ff385c]/10 px-2.5 py-1 text-xs">
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            chat(text);
          }}
          className="flex gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. add a rug and a floor lamp"
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#0f0f0f] px-4 py-2.5 text-base outline-none focus:border-white/30"
            enterKeyHint="send"
          />
          <button disabled={!text.trim()} className="rounded-full bg-[#ff385c] px-4 text-sm font-semibold text-white disabled:opacity-40">
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
