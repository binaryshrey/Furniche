'use client';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { panoForRoom } from '@/lib/fit';
import { useLighting, LIGHT_PRESETS } from '@/lib/lighting';
import { look, step } from '@/lib/remoteActions';
import { useViewerState } from '@/lib/sceneBridge';
import { useStore } from '@/lib/store';
import type { ModelGeometry } from '@/lib/types';

type Command =
  | { type: 'look'; dx: number; dy: number }
  | { type: 'step'; dir: 'forward' | 'back' }
  | { type: 'room'; id: string }
  | { type: 'light'; preset: keyof typeof LIGHT_PRESETS }
  | { type: 'chat'; text: string }
  | { type: 'furnished'; on: boolean }
  | { type: 'frame' }
  | { type: 'hello' };

const KEY = 'furniche:remote';
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36);

function lightName(): 'evening' | 'daylight' | 'neutral' | 'custom' {
  const { brightness, warmth } = useLighting.getState();
  for (const [k, v] of Object.entries(LIGHT_PRESETS)) if (Math.abs(v.brightness - brightness) < 0.02 && Math.abs(v.warmth - warmth) < 0.02) return k as 'evening' | 'daylight' | 'neutral';
  return 'custom';
}

// Phone remote: a QR code on the big screen opens /remote/<id> on a phone, which then drives the
// tour live: look around, step, jump rooms, change the light, Auto-furnish and chat. Commands
// arrive over a server-sent-events stream; the screen publishes its state back for the phone.
export default function PhoneRemote({ geometry, title }: { geometry: ModelGeometry | null; title: string }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [phoneOn, setPhoneOn] = useState(false);
  const reply = useRef<{ text: string; suggestions: string[] } | null>(null);
  const geo = useRef(geometry);
  geo.current = geometry;

  // Reuse this tab's remote session so a reload keeps a connected phone working.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) setId(saved);
    } catch {
      /* storage blocked */
    }
  }, []);

  function start() {
    setOpen(true);
    if (id) return;
    const fresh = newId();
    try {
      sessionStorage.setItem(KEY, fresh);
    } catch {
      /* storage blocked: still works for this page */
    }
    setId(fresh);
  }

  // The address the phone opens, and its QR code.
  useEffect(() => {
    if (!id || !open || url) return;
    fetch('/api/remote/info')
      .then((r) => r.json())
      .then(async (j) => {
        if (!j.base) return setProblem(j.error ?? 'No network address for the phone.');
        const u = `${j.base}/remote/${id}`;
        setUrl(u);
        setQr(await QRCode.toDataURL(u, { margin: 1, width: 360, color: { dark: '#111111', light: '#ffffff' } }));
      })
      .catch(() => setProblem('Could not work out the address for the phone.'));
  }, [id, open, url]);

  // Listen for the phone's commands.
  useEffect(() => {
    if (!id) return;
    const es = new EventSource(`/api/remote/${id}/events`);
    es.onmessage = async (e) => {
      let c: Command;
      try {
        c = JSON.parse(e.data);
      } catch {
        return;
      }
      setPhoneOn(true);
      const sdk = useViewerState.getState().sdk;
      const { moveToPano } = await import('@/components/viewer/MatterportHost');
      switch (c.type) {
        case 'look':
          return look(sdk, c.dx, c.dy);
        case 'step':
          return step(sdk, geo.current, c.dir, (s, pano) => moveToPano(s, pano, false, 2));
        case 'room': {
          const room = geo.current?.rooms.find((r) => r.id === c.id);
          const pano = room && geo.current ? panoForRoom(room, geo.current.panos) : null;
          if (sdk && pano) moveToPano(sdk, pano.id, false, 2);
          return;
        }
        case 'light':
          return useLighting.getState().set(LIGHT_PRESETS[c.preset] ?? LIGHT_PRESETS.neutral);
        case 'furnished':
          return useStore.getState().setShowFurnished(!!c.on);
        case 'chat':
          return void window.dispatchEvent(new CustomEvent('fn-chat', { detail: c.text }));
        case 'frame':
          return void window.dispatchEvent(new Event('fn-frame'));
      }
    };
    return () => es.close();
  }, [id]);

  // Keep the assistant's latest reply for the phone.
  useEffect(() => {
    const onReply = (e: Event) => (reply.current = (e as CustomEvent<{ text: string; suggestions: string[] }>).detail);
    window.addEventListener('fn-chat-reply', onReply);
    return () => window.removeEventListener('fn-chat-reply', onReply);
  }, []);

  // Publish what the screen shows, so the phone's buttons match it.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const push = async () => {
      const g = geo.current;
      const st = useStore.getState();
      const d = st.design();
      const v = useViewerState.getState();
      const state = {
        title,
        rooms: (g?.rooms ?? []).filter((r) => r.areaM2 > 4 && !/closet|void|hallway/i.test(r.label)).map((r) => ({ id: r.id, label: r.label, area: Math.round(r.areaM2) })),
        roomId: v.currentRoomId,
        light: lightName(),
        total: d.items.reduce((s, i) => s + (st.product(i.productId)?.priceUsd ?? 0), 0),
        pieces: d.items.length,
        showFurnished: st.showFurnished,
        hasDefurnish: v.hasDefurnish,
        ready: !!v.sdk,
        reply: reply.current?.text ?? null,
        suggestions: reply.current?.suggestions ?? [],
      };
      try {
        const r = await fetch(`/api/remote/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
        const j = await r.json();
        if (alive) setPhoneOn(!!j.phoneSeen && j.now - j.phoneSeen < 8000);
      } catch {
        /* try again next tick */
      }
    };
    push();
    const t = setInterval(push, 1200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id, title]);

  return (
    <>
      <button
        onClick={start}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-card"
        title="Control this tour from your phone"
        aria-label={phoneOn ? 'Phone remote connected' : 'Open phone remote'}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18h2" />
        </svg>
        Phone remote
        {phoneOn && <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />}
      </button>

      {open && (
        <div data-fn-ui className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Phone remote">
          <div className="w-full max-w-sm rounded-2xl border border-line bg-paper p-5 text-center shadow-swatch" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-semibold">Control the tour from your phone</h2>
            <p className="mt-1 text-xs text-muted">Scan with your phone’s camera. Look around, walk, switch rooms, change the light, furnish and chat, live on this screen.</p>
            <div className="mx-auto mt-4 grid h-64 w-64 place-items-center overflow-hidden rounded-xl bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {qr ? <img src={qr} alt="QR code for the phone remote" className="h-full w-full" /> : <span className="text-xs text-black/60">{problem ?? 'Making the code…'}</span>}
            </div>
            {url && (
              <p className="mt-3 break-all text-[11px] text-muted">
                Or open <span className="text-ink">{url}</span>
              </p>
            )}
            <p className={`mt-3 text-sm font-medium ${phoneOn ? 'text-ok' : 'text-muted'}`}>{phoneOn ? '● Phone connected' : 'Waiting for your phone…'}</p>
            <p className="mt-1 text-[11px] text-muted">Your phone needs to be on the same Wi-Fi as this computer.</p>
            <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-lg btn-brand py-2 text-sm font-semibold">
              {phoneOn ? 'Done' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
