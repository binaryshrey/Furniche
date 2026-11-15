import type { Engine, PhotoEvent } from './photo3d';
import { hasStoredAsset, keepAsset } from './photoAssets';

// Photo to 3D straight from this browser to the GPU server on this computer
// (scripts/photo3d_local.py). The live site's servers can't reach this computer, but its pages can:
// open the link the server prints (http://127.0.0.1:8765/connect) once, and this browser remembers
// it. The server speaks the same job API as for the app's server (lib/photo3d.ts).
export type DirectGpu = { url: string; token: string };

const KEY = 'furniche.photo3d.gpu';
const LIMIT_MS = 8 * 60_000; // a whole build
const ANSWER_MS = 90_000; // one request
const POLL_MS = 1500;

// Only a server on this computer: a link can't send your photos anywhere else.
export const isLocalGpu = (url: string) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);

export function directGpu(): DirectGpu | null {
  try {
    const g = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return typeof g?.url === 'string' && isLocalGpu(g.url) ? { url: g.url, token: String(g.token ?? '') } : null;
  } catch {
    return null;
  }
}

export function setDirectGpu(g: DirectGpu | null) {
  try {
    if (g) localStorage.setItem(KEY, JSON.stringify(g));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing to remember it in
  }
}

class Unanswered extends Error {
  constructor(
    message: string,
    readonly retry = true,
    readonly slow = false,
  ) {
    super(message);
  }
}
const UNREACHABLE = "Can't reach the Photo to 3D server on this computer. Check that scripts/photo3d_local.py is running, and let this site reach it if the browser asks.";
const SLOW = "The Photo to 3D server on this computer is taking too long, which usually means the computer is short of memory. Close apps you don't need.";

async function call(gpu: DirectGpu, path: string, signal: AbortSignal, init: RequestInit = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(ANSWER_MS);
  const res = await fetch(`${gpu.url}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${gpu.token}` },
    signal: typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout,
    cache: 'no-store',
  }).catch((e) => {
    if (signal.aborted) throw e;
    throw (e as Error)?.name === 'TimeoutError' ? new Unanswered(SLOW, true, true) : new Unanswered(UNREACHABLE);
  });
  if (res.status === 401) throw new Unanswered('The Photo to 3D server on this computer refused this browser. Open http://127.0.0.1:8765/connect again.', false);
  return res;
}

// A stable id for a photo, from its bytes.
async function photoKey(photo: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await new Blob(['direct:', photo]).arrayBuffer());
  return Array.from(new Uint8Array(hash).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The same events as the app's server sends; the files go into this browser (lib/photoAssets.ts).
export async function* directBuild(gpu: DirectGpu, photo: Blob, engine: Engine, signal: AbortSignal): AsyncGenerator<PhotoEvent> {
  const id = await photoKey(photo);
  yield { type: 'id', id };
  try {
    if ((await hasStoredAsset(id, engine)) && (await hasStoredAsset(id, 'cutout'))) {
      yield { type: 'cutout' };
      yield { type: 'done' };
      return;
    }
    const octets = { 'Content-Type': 'application/octet-stream' };
    const cut = await call(gpu, '/cutout', signal, { method: 'POST', body: photo, headers: octets });
    if (!cut.ok) throw new Unanswered(`The server on this computer could not cut the piece out (${cut.status}).`);
    const png = await cut.blob();
    await keepAsset(id, 'cutout', png);
    yield { type: 'cutout' };

    const res = await call(gpu, `/jobs?quality=${engine}`, signal, { method: 'POST', body: png, headers: octets });
    const job = res.ok ? (await res.json())?.id : null;
    if (typeof job !== 'string') throw new Unanswered(`The server on this computer could not start a build (${res.status}).`);
    yield { type: 'step', step: 'shape', fraction: null };
    const until = Date.now() + LIMIT_MS;
    for (;;) {
      await sleep(POLL_MS);
      if (Date.now() > until) throw new Unanswered(SLOW);
      // A busy computer can take minutes to answer while the build goes on: keep asking.
      const r = await call(gpu, `/jobs/${encodeURIComponent(job)}`, signal).catch((e) => {
        if (e instanceof Unanswered && e.slow) return null;
        throw e;
      });
      if (!r) continue;
      if (r.status === 200) {
        const glb = await r.blob();
        if (glb.size < 12 || (await glb.slice(0, 4).text()) !== 'glTF') throw new Unanswered('The server on this computer returned a file that is not a 3D model.');
        await keepAsset(id, engine, new Blob([glb], { type: 'model/gltf-binary' }));
        yield { type: 'done' };
        return;
      }
      const body = await r.json().catch(() => null);
      if (r.status !== 202) throw new Unanswered(`Your GPU could not build this photo (${body?.error ?? r.status}). Try another photo.`);
      if (body?.ahead > 0) yield { type: 'queue', position: body.ahead, eta: null };
    }
  } catch (e) {
    if (signal.aborted) return;
    yield { type: 'error', message: e instanceof Unanswered ? e.message : UNREACHABLE, retry: e instanceof Unanswered ? e.retry : true };
  }
}
