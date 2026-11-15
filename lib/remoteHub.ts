import 'server-only';

// Phone remote relay. The editor on the big screen opens a live stream (server-sent events) for a
// random session id and publishes its state; the phone that scanned the QR code posts commands and
// polls that state. Held in this server's memory: fine for `next dev` / `next start` on one
// machine. A multi-instance host would need a shared store instead.

export type RemoteCommand =
  | { type: 'look'; dx: number; dy: number } // degrees: + right / + up
  | { type: 'step'; dir: 'forward' | 'back' }
  | { type: 'room'; id: string }
  | { type: 'light'; preset: 'evening' | 'daylight' | 'neutral' }
  | { type: 'chat'; text: string }
  | { type: 'furnished'; on: boolean } // the seller's furniture
  | { type: 'frame' } // show off the room you're in
  | { type: 'hello' };

export type RemoteState = {
  title: string;
  rooms: { id: string; label: string; area: number }[];
  roomId: string | null;
  light: 'evening' | 'daylight' | 'neutral' | 'custom';
  total: number;
  pieces: number;
  showFurnished: boolean;
  hasDefurnish: boolean;
  ready: boolean;
  reply: string | null; // the assistant's latest reply, so the phone sees answers to its chat
  suggestions: string[];
};

type Session = {
  listeners: Set<(c: RemoteCommand) => void>;
  state: RemoteState | null;
  desktopSeen: number;
  phoneSeen: number;
};

const g = globalThis as unknown as { __fnRemote?: Map<string, Session> };
const sessions = (g.__fnRemote ??= new Map());

export const validId = (id: string) => /^[a-z0-9]{16,40}$/.test(id);

function session(id: string): Session {
  let s = sessions.get(id);
  if (!s) {
    s = { listeners: new Set(), state: null, desktopSeen: 0, phoneSeen: 0 };
    sessions.set(id, s);
  }
  return s;
}

// Forget sessions nobody has touched for a day.
function sweep() {
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [id, s] of sessions) if (!s.listeners.size && Math.max(s.desktopSeen, s.phoneSeen) < cutoff) sessions.delete(id);
}

export function subscribe(id: string, fn: (c: RemoteCommand) => void): () => void {
  sweep();
  const s = session(id);
  s.listeners.add(fn);
  s.desktopSeen = Date.now();
  return () => s.listeners.delete(fn);
}

export function publish(id: string, cmd: RemoteCommand): number {
  const s = session(id);
  s.phoneSeen = Date.now();
  for (const fn of s.listeners) fn(cmd);
  return s.listeners.size;
}

export function setState(id: string, state: RemoteState) {
  const s = session(id);
  s.state = state;
  s.desktopSeen = Date.now();
}

export function getState(id: string, fromPhone = false) {
  const s = session(id);
  if (fromPhone) s.phoneSeen = Date.now();
  return { state: s.state, screenConnected: s.listeners.size > 0, phoneSeen: s.phoneSeen };
}
