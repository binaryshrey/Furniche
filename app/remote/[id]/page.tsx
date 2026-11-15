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
  note?: string | null;
};

// Minimal Web Speech API surface (webkit-prefixed on Safari and Chrome).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const buzz = (ms = 12) => (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(ms);

// A face button, PlayStation style. Fires on press (not release) so it feels instant.
function Face({ symbol, color, label, onPress, style, labelAbove }: { symbol: string; color: string; label: string; onPress: () => void; style: React.CSSProperties; labelAbove?: boolean }) {
  return (
    <button
      onPointerDown={(e) => (e.preventDefault(), buzz(), onPress())}
      aria-label={label}
      className="absolute grid h-[68px] w-[68px] place-items-center rounded-full bg-[#1d1d1f] shadow-[inset_0_-4px_0_rgba(0,0,0,.45),0_6px_16px_rgba(0,0,0,.5)] active:translate-y-[2px] active:shadow-[inset_0_-1px_0_rgba(0,0,0,.45)]"
      style={style}
    >
      <span className="text-[30px] leading-none" style={{ color }}>
        {symbol}
      </span>
      <span className={`absolute whitespace-nowrap text-[10px] font-semibold text-[#a3a3a3] ${labelAbove ? '-top-4' : '-bottom-5'}`}>{label}</span>
    </button>
  );
}

function Shoulder({ children, onPress, active, side }: { children: React.ReactNode; onPress: () => void; active?: boolean; side: 'l' | 'r' }) {
  return (
    <button
      onPointerDown={(e) => (e.preventDefault(), buzz(), onPress())}
      className={`h-11 min-w-[112px] px-4 text-sm font-semibold shadow-[inset_0_-3px_0_rgba(0,0,0,.4)] active:translate-y-[1px] ${side === 'l' ? 'rounded-l-[22px] rounded-r-lg' : 'rounded-r-[22px] rounded-l-lg'} ${active ? 'bg-[#ff385c] text-white' : 'bg-[#1d1d1f] text-[#f7f7f7]'}`}
    >
      {children}
    </button>
  );
}

// The phone side of the remote, laid out like a game controller in landscape: an analog stick to
// look around, face buttons to move and act, shoulder buttons for rooms and light, and the mic in
// the middle. Every press posts a command the big screen carries out at once.
export default function Remote({ params }: { params: { id: string } }) {
  const id = params.id;
  const [state, setState] = useState<RemoteState | null>(null);
  const [screen, setScreen] = useState<'connecting' | 'on' | 'off'>('connecting');
  const [portrait, setPortrait] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const lastReply = useRef<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  const send = useCallback(
    (command: Record<string, unknown>) =>
      fetch(`/api/remote/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) })
        .then((r) => r.json())
        .then((j) => setScreen(j.delivered ? 'on' : 'off'))
        .catch(() => setScreen('off')),
    [id],
  );

  const say = useCallback((t: string, ms = 2600) => {
    setToast(t);
    window.clearTimeout((say as unknown as { t?: number }).t);
    (say as unknown as { t?: number }).t = window.setTimeout(() => setToast(null), ms);
  }, []);

  // Hello, then keep the screen's state fresh.
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
    const t = setInterval(poll, 900);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, send]);

  useEffect(() => {
    if (state?.note) say(state.note);
  }, [state?.note, say]);
  useEffect(() => {
    if (state?.reply && state.reply !== lastReply.current) {
      lastReply.current = state.reply;
      setWaiting(false);
    }
  }, [state?.reply]);

  // Landscape: ask for it when the phone is upright.
  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  async function goLandscape() {
    // Android can lock landscape once full screen; iPhone can't, but turning the phone works.
    try {
      await document.documentElement.requestFullscreen?.();
      await (window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation?.lock?.('landscape');
    } catch {
      /* not supported */
    }
  }

  // ---- Analog stick: hold off-centre to keep turning, faster the further you push ----
  const stick = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const knobRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const t = setInterval(() => {
      const { x, y } = knobRef.current; // -1..1
      const mag = Math.hypot(x, y);
      if (mag < 0.15) return; // dead zone
      const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.6); // fine control near centre
      send({ type: 'look', dx: curve(x) * 14, dy: -curve(y) * 8 });
    }, 110);
    return () => clearInterval(t);
  }, [send]);
  const moveStick = (e: React.PointerEvent) => {
    const r = stick.current!.getBoundingClientRect();
    const R = r.width / 2;
    let x = (e.clientX - (r.left + R)) / R;
    let y = (e.clientY - (r.top + R)) / R;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    knobRef.current = { x, y };
    setKnob({ x, y });
  };
  const releaseStick = () => {
    knobRef.current = { x: 0, y: 0 };
    setKnob({ x: 0, y: 0 });
  };

  // ---- Rooms (L1 / R1) and light (L2 / R2) ----
  const rooms = state?.rooms ?? [];
  const roomIndex = rooms.findIndex((r) => r.id === state?.roomId);
  const room = roomIndex >= 0 ? rooms[roomIndex] : null;
  const nextRoom = (d: 1 | -1) => {
    if (!rooms.length) return;
    const r = rooms[(roomIndex + d + rooms.length) % rooms.length] ?? rooms[0];
    send({ type: 'room', id: r.id });
    say(`Going to the ${r.label.toLowerCase()}`);
  };

  // ---- Chat and voice ----
  function chat(msg: string) {
    const m = msg.trim();
    if (!m) return;
    send({ type: 'chat', text: m });
    setWaiting(true);
    setText('');
    setTyping(false);
  }
  function mic() {
    buzz(20);
    if (listening) return rec.current?.stop();
    if (!window.isSecureContext) {
      return say('Voice needs the secure link. On the computer, start the app with npm run dev:https and scan again.', 6000);
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (!Ctor) return say('This browser has no voice input. Use the keyboard instead.', 4000);
    const r = new Ctor();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    let finalText = '';
    r.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) {
        t += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = t;
      }
      setHeard(t);
    };
    r.onerror = (e) => say(e.error === 'not-allowed' ? 'Allow the microphone for this page to talk to FurNiche AI.' : `Didn’t catch that (${e.error}).`, 4000);
    r.onend = () => {
      setListening(false);
      const said = (finalText || '').trim();
      setHeard('');
      if (said) chat(said);
    };
    rec.current = r;
    setHeard('');
    setListening(true);
    r.start();
  }

  const light = state?.light;
  return (
    <main
      className="fixed inset-0 select-none overflow-hidden bg-[radial-gradient(120%_120%_at_50%_0%,#26262a,#0b0b0c_70%)] text-[#f7f7f7]"
      style={{ touchAction: 'none', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      {/* Shoulders */}
      <div className="absolute inset-x-4 top-3 flex items-start justify-between">
        <div className="flex flex-col gap-1.5">
          <Shoulder side="l" onPress={() => nextRoom(-1)}>
            L1 ◀ Room
          </Shoulder>
          <Shoulder side="l" active={light === 'evening'} onPress={() => (send({ type: 'light', preset: light === 'evening' ? 'neutral' : 'evening' }), say(light === 'evening' ? 'Sunlight off' : 'Sunset light'))}>
            L2 🌇 Sunset
          </Shoulder>
        </div>

        <div className="mx-2 min-w-0 flex-1 pt-1 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
            <span className={`h-2 w-2 rounded-full ${screen === 'on' ? 'bg-[#6cc08a]' : screen === 'off' ? 'bg-[#ea6a58]' : 'bg-[#a3a3a3]'}`} />
            <span className="text-[#ff385c]">FurNiche AI</span>
            <span className="text-[#a3a3a3]">{screen === 'on' ? 'connected' : screen === 'off' ? 'screen offline' : 'connecting'}</span>
          </div>
          <div className="truncate text-base font-semibold">{room ? room.label : state?.title ?? 'Connecting…'}</div>
          <div className="truncate text-[11px] text-[#a3a3a3]">
            {state?.title}
            {state && state.pieces > 0 ? ` · ${state.pieces} pieces · ${usd(state.total)}` : ''}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <Shoulder side="r" onPress={() => nextRoom(1)}>
            Room ▶ R1
          </Shoulder>
          <Shoulder side="r" active={light === 'daylight'} onPress={() => (send({ type: 'light', preset: light === 'daylight' ? 'neutral' : 'daylight' }), say(light === 'daylight' ? 'Sunlight off' : 'Morning sun'))}>
            🌅 Morning R2
          </Shoulder>
        </div>
      </div>

      {/* Left: analog stick */}
      <div className="absolute bottom-6 left-8 flex flex-col items-center gap-2">
        <div
          ref={stick}
          className="relative h-[150px] w-[150px] rounded-full bg-[#141416] shadow-[inset_0_6px_18px_rgba(0,0,0,.7),0_0_0_2px_#26262a]"
          onPointerDown={(e) => ((e.target as HTMLElement).setPointerCapture?.(e.pointerId), buzz(8), moveStick(e))}
          onPointerMove={(e) => e.buttons && moveStick(e)}
          onPointerUp={releaseStick}
          onPointerCancel={releaseStick}
          aria-label="Look around: push the stick"
        >
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[66px] w-[66px] rounded-full bg-[radial-gradient(circle_at_35%_30%,#3a3a3f,#1c1c1f)] shadow-[0_6px_14px_rgba(0,0,0,.6)]"
            style={{ transform: `translate(calc(-50% + ${knob.x * 42}px), calc(-50% + ${knob.y * 42}px))` }}
          />
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#a3a3a3]">Look around</span>
      </div>

      {/* Right: face buttons */}
      <div className="absolute bottom-7 right-8 h-[190px] w-[190px]">
        <Face symbol="△" color="#3ddc97" label="Step forward" labelAbove onPress={() => send({ type: 'step', dir: 'forward' })} style={{ left: 61, top: 0 }} />
        <Face symbol="✕" color="#6ea8ff" label="Step back" onPress={() => send({ type: 'step', dir: 'back' })} style={{ left: 61, top: 112 }} />
        <Face symbol="○" color="#ff5c6c" label="Auto-furnish" onPress={() => (chat('Auto-furnish every room'), say('Furnishing every room…'))} style={{ left: 122, top: 56 }} />
        <Face symbol="□" color="#ff8ad8" label="Show room" onPress={() => send({ type: 'frame' })} style={{ left: 0, top: 56 }} />
      </div>

      {/* Centre: mic, reply and quick picks */}
      <div className="absolute bottom-5 left-1/2 flex w-[34%] max-w-[300px] -translate-x-1/2 flex-col items-center gap-2">
        {(heard || waiting || state?.reply) && (
          <div className="max-h-[84px] w-full overflow-hidden rounded-2xl bg-black/50 px-3 py-2 text-center text-[12px] leading-snug text-[#e9e9e9]">
            {heard ? `“${heard}”` : waiting ? 'Working on it…' : state?.reply}
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onPointerDown={(e) => (e.preventDefault(), buzz(), setTyping(true))}
            className="grid h-11 w-11 place-items-center rounded-full bg-[#1d1d1f] text-lg"
            aria-label="Type a message"
          >
            ⌨︎
          </button>
          <button
            onPointerDown={(e) => (e.preventDefault(), mic())}
            className={`grid h-[74px] w-[74px] place-items-center rounded-full text-3xl shadow-[0_8px_22px_rgba(255,56,92,.35)] ${listening ? 'animate-pulse bg-[#ff385c]' : 'bg-gradient-to-b from-[#ff5a77] to-[#e31c5f]'}`}
            aria-label={listening ? 'Stop listening' : 'Talk to FurNiche AI'}
          >
            🎙
          </button>
          {state?.hasDefurnish ? (
            <button
              onPointerDown={(e) => (e.preventDefault(), buzz(), send({ type: 'furnished', on: !state.showFurnished }))}
              className={`grid h-11 w-11 place-items-center rounded-full text-[10px] font-bold leading-tight ${state.showFurnished ? 'bg-[#f7f7f7] text-black' : 'bg-[#1d1d1f]'}`}
              aria-label="Show or hide the seller’s furniture"
            >
              Seller
            </button>
          ) : (
            <span className="w-11" />
          )}
        </div>
        {state && state.suggestions.length > 0 && (
          <div className="flex max-w-full gap-1.5 overflow-x-auto">
            {state.suggestions.slice(0, 3).map((s) => (
              <button key={s} onPointerDown={(e) => (e.preventDefault(), buzz(), chat(s))} className="shrink-0 rounded-full border border-[#ff385c]/50 bg-[#ff385c]/10 px-2.5 py-1 text-[11px]">
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {toast && <div className="absolute left-1/2 top-[86px] -translate-x-1/2 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black shadow-lg">{toast}</div>}

      {/* Keyboard sheet */}
      {typing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            chat(text);
          }}
          className="absolute inset-x-0 top-0 flex gap-2 bg-[#0b0b0c] p-3"
          style={{ touchAction: 'manipulation' }}
        >
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. add a rug and a floor lamp"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-[#1d1d1f] px-4 py-2.5 text-base outline-none"
            enterKeyHint="send"
          />
          <button className="rounded-full bg-[#ff385c] px-4 text-sm font-semibold text-white">Send</button>
          <button type="button" onClick={() => setTyping(false)} className="rounded-full bg-[#1d1d1f] px-3 text-sm">
            ✕
          </button>
        </form>
      )}

      {/* Upright phone: ask to turn it */}
      {portrait && !typing && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#0b0b0c] px-8 text-center">
          <div className="text-5xl" style={{ animation: 'spin 2.4s ease-in-out infinite' }}>
            📱
          </div>
          <h1 className="text-xl font-semibold">Turn your phone sideways</h1>
          <p className="text-sm text-[#a3a3a3]">The FurNiche AI controller works in landscape, like a game pad.</p>
          <button onClick={goLandscape} className="rounded-full bg-[#ff385c] px-5 py-2.5 text-sm font-semibold text-white">
            Go full screen
          </button>
          <style>{'@keyframes spin{0%,30%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}'}</style>
        </div>
      )}
    </main>
  );
}
