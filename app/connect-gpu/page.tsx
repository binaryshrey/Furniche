'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TopNav } from '@/components/ui/Brand';
import { type DirectGpu, directGpu, isLocalGpu, setDirectGpu } from '@/lib/photoDirect';

// Opened from the link the Photo to 3D server on this computer prints (scripts/photo3d_local.py,
// /connect): this browser remembers the server, and Photo to 3D builds on it (lib/photoDirect.ts).
// The server's address and token come in the URL's #fragment, which never reaches this site's servers.
export default function ConnectGpu() {
  const [gpu, setGpu] = useState<DirectGpu | null>(null);
  const [health, setHealth] = useState<'checking' | 'ok' | 'unreachable'>('checking');
  const [device, setDevice] = useState('');
  const [ready, setReady] = useState(false);

  // Chrome asks once whether this site may reach this computer; until it's allowed, this fails.
  function check(g: DirectGpu) {
    setHealth('checking');
    fetch(`${g.url}/health`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((h) => (setDevice(String(h?.device ?? '')), setHealth(h?.ok ? 'ok' : 'unreachable')))
      .catch(() => setHealth('unreachable'));
  }

  useEffect(() => {
    const p = new URLSearchParams(location.hash.slice(1));
    const url = p.get('url');
    if (url && isLocalGpu(url)) setDirectGpu({ url, token: p.get('token') ?? '' });
    if (location.hash) history.replaceState(null, '', location.pathname); // keep the token out of the address bar
    const g = directGpu();
    setGpu(g);
    setReady(true);
    if (g) check(g);
  }, []);

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-xl px-6 py-10">
        <h1 className="font-display text-3xl">Photo to 3D on this computer</h1>
        {!ready ? null : gpu ? (
          <div className="mt-4 space-y-4 text-sm">
            <p>
              Photo to 3D in this browser now builds on the GPU server on this computer (<span className="num">{gpu.url}</span>): one model, no daily limits.
            </p>
            <p className={health === 'ok' ? 'text-ok' : health === 'unreachable' ? 'text-bad' : 'text-muted'}>
              {health === 'ok'
                ? `The server is running${device ? ` (${device})` : ''}.`
                : health === 'unreachable'
                  ? "The server isn't answering. Start scripts/photo3d_local.py, and if the browser asks whether this site may reach devices on your network or this computer, allow it."
                  : 'Checking the server…'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/explore" className="rounded-lg btn-brand px-4 py-2 text-sm font-medium">
                Pick a home
              </Link>
              {health === 'unreachable' && (
                <button onClick={() => check(gpu)} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-ink/40">
                  Check again
                </button>
              )}
              <button onClick={() => (setDirectGpu(null), setGpu(null))} className="rounded-lg border border-line px-4 py-2 text-sm hover:border-ink/40">
                Stop using it
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">
            Not connected: Photo to 3D in this browser uses the free shared GPUs. To use a GPU server on this computer, start scripts/photo3d_local.py and open the link it prints.
          </p>
        )}
      </main>
    </div>
  );
}
