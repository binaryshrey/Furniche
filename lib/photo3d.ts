import 'server-only';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client, handle_file } from '@gradio/client';
import { PNG } from 'pngjs';
import { cacheDir } from '@/lib/cacheDir';

// Photo to 3D, free either way:
// - On your own GPU (PHOTO3D_GPU_URL): scripts/photo3d_gpu.ipynb runs Tencent's Hunyuan3D-2 on a
//   free Kaggle or Colab GPU. It cuts the piece out, removes the photo's lighting and reflections,
//   and builds a textured mesh; no daily limits while the notebook runs.
// - Otherwise on Hugging Face's shared GPUs (ZeroGPU Spaces): the TRELLIS Space cuts the piece out
//   on its CPU, then one GPU run builds the mesh: Stability AI's Stable Fast 3D (quick, seconds) or
//   Microsoft's TRELLIS (detail, about a minute). Hugging Face meters free use per day: a free
//   account (HF_TOKEN) gets about 3 runs and 5 minutes of reserved GPU time; without a token, less.
// Finished models are cached on disk by the photo's hash, so a photo is only ever built once.

export type Engine = 'quick' | 'detail';
export const ENGINES: Engine[] = ['quick', 'detail'];

export const SPACES = { cutout: 'trellis-community/TRELLIS', quick: 'stabilityai/stable-fast-3d', detail: 'trellis-community/TRELLIS' } as const;

export type PhotoEvent =
  | { type: 'id'; id: string }
  | { type: 'cutout'; png?: string } // png, glb: the files themselves (base64), for the browser to keep
  | { type: 'queue'; position: number; eta: number | null }
  | { type: 'step'; step: 'shape'; fraction: number | null }
  | { type: 'done'; glb?: string }
  | { type: 'error'; message: string; retry: boolean }; // retry: whether trying again now could help

export class Photo3DError extends Error {
  constructor(
    message: string,
    readonly retry = true,
  ) {
    super(message);
  }
}

// What a Space client needs to do here; tests swap in a fake.
type SpaceEvent =
  | { type: 'data'; data: unknown }
  | { type: 'status'; stage: string; queue?: boolean; position?: number; eta?: number; message?: unknown; title?: string; progress_data?: { index: number | null; length: number | null }[] }
  | { type: string };
export type SpaceApp = { submit: (endpoint: string, data: unknown[] | Record<string, unknown>) => AsyncIterable<SpaceEvent> };
export const spaces = {
  connect: async (space: string, token: string | undefined): Promise<SpaceApp> =>
    Client.connect(space, { token: token as `hf_${string}` | undefined, events: ['data', 'status'] }) as unknown as SpaceApp,
};

const hfToken = () => process.env.HF_TOKEN?.trim() || undefined;
export const tokenSet = () => !!hfToken();

// Your own GPU server: the notebook's link from its printout, or this computer's (scripts/photo3d_local.py).
const gpu = () => {
  const url = process.env.PHOTO3D_GPU_URL?.trim().replace(/\/+$/, '');
  return url ? { url, token: process.env.PHOTO3D_GPU_TOKEN?.trim() ?? '' } : null;
};
export const gpuSet = () => !!gpu();
const onThisComputer = () => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(gpu()?.url ?? '');
// How often to ask your GPU about a build, how long to wait for each answer, and for the whole build. Tests shorten them.
export const timing = { gpuPollMs: 1500, gpuAnswerMs: 90_000, limitMs: 8 * 60_000 };

const CACHE = cacheDir('photo3d');
export const isPhotoId = (s: string) => /^[a-f0-9]{24}$/.test(s);
// Models from your GPU are kept apart from the shared GPUs' ones, so switching never shows an old model.
export const photoId = (bytes: Uint8Array, onGpu = gpuSet()) => {
  const hash = createHash('sha256');
  if (onGpu) hash.update('gpu:');
  return hash.update(bytes).digest('hex').slice(0, 24);
};
const assetPath = (id: string, asset: 'cutout' | Engine) => path.join(CACHE, asset === 'cutout' ? `${id}.cutout` : `${id}.${asset}.glb`);

export async function readAsset(id: string, asset: 'cutout' | Engine): Promise<Buffer | null> {
  try {
    return await readFile(assetPath(id, asset));
  } catch {
    return null;
  }
}

// Written to a temporary name and renamed, so a half-written file is never served.
async function writeAtomic(file: string, data: Uint8Array) {
  await mkdir(CACHE, { recursive: true });
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

export const imageType = (b: Uint8Array) =>
  b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : Buffer.from(b.subarray(8, 12)).toString('latin1') === 'WEBP' ? 'image/webp' : 'application/octet-stream';

// The url of the first file in a Space's output: a file, an update carrying one, or a list.
export function fileUrl(value: unknown, ext?: RegExp): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const url = fileUrl(v, ext);
      if (url) return url;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const v = value as { url?: unknown; path?: unknown; value?: unknown };
  if (typeof v.url === 'string' && (!ext || ext.test(String(v.path ?? v.url)))) return v.url;
  return v.value ? fileUrl(v.value, ext) : null;
}

// Hugging Face's quota message, said plainly. It reads like: "You have exceeded your ZeroGPU quota
// (120s requested vs. 180s left). Try again in 23:59:59. Authenticate with a Hugging Face token…"
export function spaceError(message: string, title = ''): Photo3DError {
  if (/quota/i.test(message) || /quota/i.test(title)) {
    const [h, m, sec] = (message.match(/try again in (\d+):(\d+):(\d+)/i) ?? []).slice(1).map(Number);
    const wait = h == null ? null : h * 3600 + m * 60 + sec;
    const when = wait == null ? '' : wait < 60 ? ' Try again in a minute.' : ` Try again in ${h ? `${h} h ${m} min` : `${m} min`}.`;
    return new Photo3DError(
      hfToken()
        ? `Your free Hugging Face GPU time is used up for now.${when}`
        : `The free GPU time for this computer is used up for now.${when} A free Hugging Face token (HF_TOKEN in .env.local) gives more.`,
      wait != null && wait <= 300,
    );
  }
  return new Photo3DError(`The free 3D service could not finish this photo (${message.slice(0, 160) || 'unknown error'}). Try again, or try another photo.`);
}

// One Space call, passing queue position and progress on as events.
async function call(app: SpaceApp, endpoint: string, data: unknown[] | Record<string, unknown>, emit: (e: PhotoEvent) => void, step?: 'shape') {
  let out: unknown = null;
  if (step) emit({ type: 'step', step, fraction: null });
  for await (const m of app.submit(endpoint, data)) {
    if (m.type === 'data') out = (m as { data: unknown }).data;
    if (m.type !== 'status') continue;
    const s = m as Extract<SpaceEvent, { type: 'status' }>;
    if (s.stage === 'error') throw spaceError(typeof s.message === 'string' ? s.message : '', s.title);
    if (s.stage === 'pending' && s.queue && typeof s.position === 'number' && s.position > 0) emit({ type: 'queue', position: s.position, eta: s.eta ?? null });
    const p = s.progress_data?.at(-1);
    if (step && p?.length) emit({ type: 'step', step, fraction: Math.min(1, (p.index ?? 0) / p.length) });
  }
  if (out == null) throw new Photo3DError(`The free 3D service returned nothing from ${endpoint}.`);
  return out;
}

async function download(url: string | null, token: string | undefined): Promise<Buffer> {
  const u = url ? new URL(url) : null;
  if (!u || u.protocol !== 'https:' || !u.hostname.endsWith('.hf.space')) throw new Photo3DError('The free 3D service returned an unexpected file link.');
  const res = await fetch(u, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(120_000), cache: 'no-store' });
  if (!res.ok) throw new Photo3DError(`Downloading the result failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

const blob = (bytes: Uint8Array, type = imageType(bytes)) => handle_file(new Blob([new Uint8Array(bytes)], { type }));

// TRELLIS's cut-out is the piece on black (its colours already multiplied by the mask) with no
// transparency. Black becomes transparent again: Stable Fast 3D and the thumbnails need the mask.
export function matte(png: Uint8Array): Buffer {
  const img = PNG.sync.read(Buffer.from(png));
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) d[i + 3] = Math.max(d[i], d[i + 1], d[i + 2]) > 4 ? 255 : 0;
  return PNG.sync.write(img);
}

async function cutOut(photo: Uint8Array, token: string | undefined, emit: (e: PhotoEvent) => void): Promise<Buffer> {
  const app = await spaces.connect(SPACES.cutout, token);
  const out = await call(app, '/preprocess_image', { image: blob(photo) }, emit);
  return matte(await download(fileUrl(out), token));
}

// Stable Fast 3D. Its run button passes its own label first ("Run" starts a build) and isn't part
// of the documented API, so the arguments go by position.
async function quick(cut: Buffer, token: string | undefined, emit: (e: PhotoEvent) => void): Promise<Buffer> {
  const app = await spaces.connect(SPACES.quick, token);
  await call(app, '/requires_bg_remove', { image: blob(cut), fr: 0.85 }, emit); // hands the cut-out to this session
  const out = await call(app, '/run_button', ['Run', blob(cut), 0.85, 'None', -1, 2048], emit, 'shape');
  return download(fileUrl(out, /\.glb$/i), token);
}

// TRELLIS: generation and GLB export are one GPU run. The Space's own defaults for sampling, with
// its largest texture.
async function detail(cut: Buffer, token: string | undefined, seed: number, emit: (e: PhotoEvent) => void): Promise<Buffer> {
  const app = await spaces.connect(SPACES.detail, token);
  const prepared = await call(app, '/preprocess_image', { image: blob(cut) }, emit); // crops to the piece, on the CPU
  const out = await call(
    app,
    '/generate_and_extract_glb',
    {
      image: Array.isArray(prepared) ? prepared[0] : prepared,
      multiimages: [],
      seed,
      ss_guidance_strength: 7.5,
      ss_sampling_steps: 12,
      slat_guidance_strength: 3,
      slat_sampling_steps: 12,
      multiimage_algo: 'stochastic',
      mesh_simplify: 0.95,
      texture_size: 2048,
    },
    emit,
    'shape',
  );
  return download(fileUrl(out, /\.glb$/i), token);
}

// Your GPU server didn't answer: nothing is listening ('down'), it took too long ('slow'), or the
// connection broke ('dropped').
type Unanswered = 'down' | 'slow' | 'dropped';
function unanswered(kind: Unanswered): string {
  if (!onThisComputer()) return "Your GPU server isn't answering. Check that the notebook is still running and PHOTO3D_GPU_URL is its current link.";
  if (kind === 'down') return "The Photo to 3D server on this computer isn't running. Start scripts/photo3d_local.py again.";
  if (kind === 'slow') return "The Photo to 3D server on this computer is taking too long, which usually means the computer is short of memory. Close apps you don't need.";
  return 'The Photo to 3D server on this computer dropped the connection. Look for an error in its terminal.';
}
class GpuUnanswered extends Photo3DError {
  constructor(readonly kind: Unanswered) {
    super(unanswered(kind));
  }
}

async function gpuFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const g = gpu()!;
  const res = await fetch(`${g.url}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${g.token}` },
    signal: AbortSignal.timeout(timing.gpuAnswerMs),
    cache: 'no-store',
  }).catch((e) => {
    const err = e as { name?: string; cause?: { code?: string } };
    throw new GpuUnanswered(err?.name === 'TimeoutError' ? 'slow' : err?.cause?.code === 'ECONNREFUSED' ? 'down' : 'dropped');
  });
  if (res.status >= 520) throw new GpuUnanswered('dropped'); // the tunnel's own errors
  if (res.status === 401) throw new Photo3DError('Your GPU server refused the token: copy PHOTO3D_GPU_TOKEN from the notebook again.', false);
  return res;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// On your GPU: build as a job and poll it, so no single request outlasts the tunnel's time limit.
async function gpuBuild(cut: Uint8Array, engine: Engine, emit: (e: PhotoEvent) => void): Promise<Buffer> {
  const res = await gpuFetch(`/jobs?quality=${engine}`, { method: 'POST', body: new Uint8Array(cut), headers: { 'Content-Type': 'application/octet-stream' } });
  const id = res.ok ? (await res.json())?.id : null;
  if (typeof id !== 'string') throw new Photo3DError(`Your GPU server could not start a build (${res.status}).`);
  emit({ type: 'step', step: 'shape', fraction: null });
  const until = Date.now() + timing.limitMs;
  for (;;) {
    await sleep(timing.gpuPollMs);
    if (Date.now() > until) throw new GpuUnanswered('slow');
    // A computer short of memory can take minutes to answer while the build goes on, and a
    // connection can break: keep asking until the time limit. Only a server that has stopped ends it.
    const r = await gpuFetch(`/jobs/${encodeURIComponent(id)}`).catch((e) => {
      if (e instanceof GpuUnanswered && e.kind !== 'down') return null;
      throw e;
    });
    if (!r) continue;
    if (r.status === 200) return Buffer.from(await r.arrayBuffer());
    const body = await r.json().catch(() => null);
    if (r.status !== 202) throw new Photo3DError(`Your GPU could not build this photo (${body?.error ?? r.status}). Try another photo.`);
    if (body?.ahead > 0) emit({ type: 'queue', position: body.ahead, eta: null });
  }
}

// The model, built or from the cache. The cut-out and the model go to the page in the events too:
// on Vercel the request that serves a file may land where the build's disk isn't.
async function build(id: string, photo: Uint8Array, engine: Engine, emit: (e: PhotoEvent) => void): Promise<Buffer> {
  const token = hfToken();
  const built = await readAsset(id, engine);
  if (built) {
    const cached = await readAsset(id, 'cutout');
    if (cached) emit({ type: 'cutout', png: cached.toString('base64') });
    return built;
  }
  const onGpu = gpuSet();
  let cut = await readAsset(id, 'cutout');
  if (!cut) {
    if (onGpu) {
      const res = await gpuFetch('/cutout', { method: 'POST', body: new Uint8Array(photo), headers: { 'Content-Type': 'application/octet-stream' } });
      if (!res.ok) throw new Photo3DError(`Your GPU could not cut the piece out (${res.status}).`);
      cut = Buffer.from(await res.arrayBuffer());
    } else cut = await cutOut(photo, token, emit);
    await writeAtomic(assetPath(id, 'cutout'), cut);
  }
  emit({ type: 'cutout', png: cut.toString('base64') });
  const glb = onGpu
    ? await gpuBuild(cut, engine, emit)
    : engine === 'quick'
      ? await quick(cut, token, emit)
      : await detail(cut, token, parseInt(id.slice(0, 8), 16) % 2_147_483_647, emit);
  if (glb.length < 12 || glb.toString('latin1', 0, 4) !== 'glTF') throw new Photo3DError('The free 3D service returned a file that is not a 3D model.');
  await writeAtomic(assetPath(id, engine), glb);
  return glb;
}

// Builds run on in the server even if the page that asked goes away, so the result is cached for
// next time; a second request for the same photo joins the running build instead of starting
// another. Kept on globalThis because Next.js may load this module more than once.
type Job = { events: PhotoEvent[]; listeners: Set<(e: PhotoEvent) => void> };
const store = globalThis as typeof globalThis & { __furnichePhoto3d?: Map<string, Job> };
const jobs = (store.__furnichePhoto3d ??= new Map());

// Calls `listen` with every event of the build (earlier ones first) until 'done' or 'error'.
// Returns a function that stops listening.
export function follow(photo: Uint8Array, engine: Engine, listen: (e: PhotoEvent) => void): () => void {
  const id = photoId(photo);
  const key = `${id}.${engine}`;
  let job = jobs.get(key);
  if (!job) {
    const fresh: Job = { events: [], listeners: new Set() };
    job = fresh;
    jobs.set(key, fresh);
    let over = false;
    const emit = (e: PhotoEvent) => {
      if (over) return;
      over = e.type === 'done' || e.type === 'error';
      fresh.events.push(e);
      fresh.listeners.forEach((l) => l(e));
      if (over) jobs.delete(key);
    };
    emit({ type: 'id', id });
    const late = gpuSet() ? unanswered('slow') : 'The free 3D service took too long. Try again in a moment.';
    const timer = setTimeout(() => emit({ type: 'error', message: late, retry: true }), timing.limitMs);
    build(id, photo, engine, emit)
      .then((glb) => emit({ type: 'done', glb: glb.toString('base64') }))
      .catch((e) => {
        if (!(e instanceof Photo3DError)) console.error('[photo3d]', e);
        emit({ type: 'error', message: e instanceof Photo3DError ? e.message : 'The free 3D service is not reachable right now. Try again in a moment.', retry: !(e instanceof Photo3DError) || e.retry });
      })
      .finally(() => clearTimeout(timer));
  }
  const current = job;
  current.events.forEach(listen);
  current.listeners.add(listen);
  return () => current.listeners.delete(listen);
}
