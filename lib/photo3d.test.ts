import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// lib/photo3d.ts against stand-in Hugging Face Spaces that answer like the real ones did
// (event shapes recorded from trellis-community/TRELLIS and stabilityai/stable-fast-3d).
const dir = mkdtempSync(path.join(tmpdir(), 'photo3d-'));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/cacheDir', () => ({ cacheDir: (name: string) => path.join(dir, name) }));
const { follow, spaces, readAsset, fileUrl, matte, SPACES, timing } = await import('./photo3d');
type PhotoEvent = Parameters<Parameters<typeof follow>[2]>[0];

// TRELLIS's cut-out: a 4 × 4 piece on black, without transparency.
function cutPng(): Buffer {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < 16; i++) {
    const inside = [5, 6, 9, 10].includes(i);
    png.data.set(inside ? [236, 96, 45, 255] : [0, 0, 0, 255], i * 4);
  }
  return PNG.sync.write(png);
}
const CUT = cutPng();
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(60)]);
const CUT_URL = 'https://trellis-community-trellis.hf.space/gradio_api/file=/tmp/gradio/a/image.png';
const SF3D_URL = 'https://stabilityai-stable-fast-3d.hf.space/file=/tmp/gradio/b/tmpx.glb';
const TRELLIS_URL = 'https://trellis-community-trellis.hf.space/gradio_api/file=/tmp/gradio/c/sample.glb';
const file = (url: string) => ({ path: url.split('file=')[1], url, size: null, orig_name: url.split('/').pop(), mime_type: null, is_stream: false, meta: { _type: 'gradio.FileData' } });
const done = (data: unknown) => [{ type: 'status', stage: 'pending', queue: true, position: 0, eta: 1 }, { type: 'data', data }, { type: 'status', stage: 'complete' }];

type Call = { space: string; endpoint: string; data: unknown };
let calls: Call[] = [];
let tokens: (string | undefined)[] = [];
let handlers: Record<string, (data: unknown) => object[]> = {};
let downloads: Record<string, Buffer> = {};

beforeEach(() => {
  calls = [];
  tokens = [];
  delete process.env.HF_TOKEN;
  handlers = {
    [`${SPACES.cutout} /preprocess_image`]: () => done([file(CUT_URL)]),
    [`${SPACES.quick} /requires_bg_remove`]: () => done([{ value: 'Run', __type__: 'update' }]),
    [`${SPACES.quick} /run_button`]: () => [
      { type: 'status', stage: 'pending', queue: true, position: 2, eta: 9 },
      ...done([{ __type__: 'update' }, { __type__: 'update' }, { visible: true, value: file(SF3D_URL), __type__: 'update' }, { __type__: 'update' }]),
    ],
    [`${SPACES.detail} /generate_and_extract_glb`]: () => [
      { type: 'status', stage: 'pending', queue: true, progress_data: [{ index: 6, length: 12, unit: 'steps', desc: 'Sampling', progress: null }] },
      ...done([{ video: file('https://trellis-community-trellis.hf.space/gradio_api/file=/tmp/gradio/c/sample.mp4') }, file(TRELLIS_URL), file(TRELLIS_URL)]),
    ],
  };
  downloads = { [CUT_URL]: CUT, [SF3D_URL]: GLB, [TRELLIS_URL]: GLB };
  spaces.connect = async (space, token) => {
    tokens.push(token);
    return {
      submit: (endpoint, data) => {
        calls.push({ space, endpoint, data });
        const events = handlers[`${space} ${endpoint}`]?.(data) ?? [{ type: 'status', stage: 'error', message: `no handler for ${endpoint}` }];
        return (async function* () {
          for (const e of events) yield e as { type: string };
        })();
      },
    };
  };
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const body = downloads[String(input)];
    if (!body) throw new Error(`unexpected download ${input}`);
    expect(new Headers(init?.headers).get('Authorization')).toBe(process.env.HF_TOKEN ? `Bearer ${process.env.HF_TOKEN}` : null);
    return new Response(new Uint8Array(body));
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
const photo = () => new Uint8Array([0xff, 0xd8, 0xff, ++n, 1, 2, 3]); // a new "JPEG" each time
const build = (bytes: Uint8Array, engine: 'quick' | 'detail') =>
  new Promise<PhotoEvent[]>((resolve) => {
    const seen: PhotoEvent[] = [];
    const stop = follow(bytes, engine, (e) => {
      seen.push(e);
      if (e.type === 'done' || e.type === 'error') queueMicrotask(() => (stop(), resolve(seen)));
    });
  });

describe('photo to 3D on Hugging Face Spaces', () => {
  it('builds a quick model: cut-out, then Stable Fast 3D, and caches both', async () => {
    const bytes = photo();
    const seen = await build(bytes, 'quick');
    expect(seen.map((e) => e.type)).toEqual(['id', 'cutout', 'step', 'queue', 'done']);
    expect(seen).toContainEqual({ type: 'queue', position: 2, eta: 9 });
    expect(calls.map((c) => `${c.space} ${c.endpoint}`)).toEqual([`${SPACES.cutout} /preprocess_image`, `${SPACES.quick} /requires_bg_remove`, `${SPACES.quick} /run_button`]);
    // The run button's own label goes first, so the arguments are positional.
    const run = calls[2].data as unknown[];
    expect([run[0], ...run.slice(2)]).toEqual(['Run', 0.85, 'None', -1, 2048]);
    expect(tokens.every((t) => t === undefined)).toBe(true);
    const id = (seen[0] as { id: string }).id;
    const cut = PNG.sync.read((await readAsset(id, 'cutout'))!);
    expect([cut.data[3], cut.data[5 * 4 + 3]]).toEqual([0, 255]); // background clear, piece solid
    expect(await readAsset(id, 'quick')).toEqual(GLB);

    // The same photo again comes from the cache, without asking any Space.
    calls = [];
    expect((await build(bytes, 'quick')).map((e) => e.type)).toEqual(['id', 'cutout', 'done']);
    expect(calls).toHaveLength(0);
  });

  it('lets a second request join a build that is already running', async () => {
    const bytes = photo();
    const [a, b] = await Promise.all([build(bytes, 'quick'), build(bytes, 'quick')]);
    expect(a.at(-1)).toEqual({ type: 'done' });
    expect(b.map((e) => e.type)).toEqual(a.map((e) => e.type));
    expect(calls.filter((c) => c.endpoint === '/run_button')).toHaveLength(1);
  });

  it('says plainly when the free GPU time is used up', async () => {
    handlers[`${SPACES.quick} /run_button`] = () => [
      {
        type: 'status',
        stage: 'error',
        title: 'ZeroGPU quota exceeded',
        message: 'You have exceeded your ZeroGPU quota (60s requested vs. 30s left). Try again in 5:12:09. Authenticate with a Hugging Face token for more quota - https://huggingface.co/settings/tokens',
      },
    ];
    const anon = (await build(photo(), 'quick')).at(-1);
    expect(anon).toMatchObject({ type: 'error', retry: false });
    expect((anon as { message: string }).message).toContain('Try again in 5 h 12 min.');
    expect((anon as { message: string }).message).toContain('HF_TOKEN');

    // A short wait (the allowance refills over time) is worth a retry.
    process.env.HF_TOKEN = 'hf_test';
    handlers[`${SPACES.quick} /run_button`] = () => [{ type: 'status', stage: 'error', title: 'ZeroGPU quota exceeded', message: 'You have exceeded your ZeroGPU quota (60s requested vs. 41s left). Try again in 0:00:19.' }];
    const signedIn = (await build(photo(), 'quick')).at(-1) as { message: string; retry: boolean };
    expect(signedIn).toMatchObject({ retry: true, message: 'Your free Hugging Face GPU time is used up for now. Try again in a minute.' });
    expect(tokens.at(-1)).toBe('hf_test');
  });

  it('builds Max detail with TRELLIS: cut-out and preparation on the CPU, one GPU run', async () => {
    const seen = await build(photo(), 'detail');
    expect(seen.at(-1)).toEqual({ type: 'done' });
    expect(seen).toContainEqual({ type: 'step', step: 'shape', fraction: 0.5 });
    expect(calls.map((c) => c.endpoint)).toEqual(['/preprocess_image', '/preprocess_image', '/generate_and_extract_glb']);
    const gen = calls.at(-1)!.data as Record<string, unknown>;
    expect((gen.image as { url: string }).url).toBe(CUT_URL);
    expect(gen).toMatchObject({ multiimages: [], texture_size: 2048, mesh_simplify: 0.95, multiimage_algo: 'stochastic' });
    expect(await readAsset((seen[0] as { id: string }).id, 'detail')).toEqual(GLB);
  });

  it('turns the black around a cut-out transparent', () => {
    const out = PNG.sync.read(matte(CUT));
    const alpha = Array.from({ length: 16 }, (_, i) => out.data[i * 4 + 3]);
    expect(alpha).toEqual(Array.from({ length: 16 }, (_, i) => ([5, 6, 9, 10].includes(i) ? 255 : 0)));
    expect([...out.data.subarray(20, 23)]).toEqual([236, 96, 45]); // colours untouched
  });

  it('refuses files that are not on a Space, or not a 3D model', async () => {
    handlers[`${SPACES.quick} /run_button`] = () => done([{ value: file('https://169.254.169.254/latest/x.glb') }]);
    const off = (await build(photo(), 'quick')).at(-1);
    expect(off).toMatchObject({ type: 'error', retry: true, message: expect.stringContaining('unexpected file link') });

    downloads[SF3D_URL] = Buffer.from('<html>busy</html>');
    handlers[`${SPACES.quick} /run_button`] = () => done([{ value: file(SF3D_URL) }]);
    const bad = (await build(photo(), 'quick')).at(-1);
    expect(bad).toMatchObject({ type: 'error', message: expect.stringContaining('not a 3D model') });
  });

  it('finds the file in any shape a Space returns it', () => {
    expect(fileUrl([[file(CUT_URL)]])).toBe(CUT_URL);
    expect(fileUrl([{ video: file(TRELLIS_URL.replace('.glb', '.mp4')) }, file(TRELLIS_URL)], /\.glb$/)).toBe(TRELLIS_URL);
    expect(fileUrl([{ __type__: 'update' }, { value: file(SF3D_URL) }], /\.glb$/)).toBe(SF3D_URL);
    expect(fileUrl([file(CUT_URL), file(TRELLIS_URL)], /\.glb$/)).toBe(TRELLIS_URL);
    expect(fileUrl(['<div/>', null, 3])).toBeNull();
  });
});

// lib/photo3d.ts against a stand-in for the job server on this computer (scripts/photo3d_local.py).
describe('photo to 3D on your own GPU server', () => {
  const defaults = { ...timing };
  let server: (path: string, init: RequestInit) => Response | Promise<Response>;
  let polls = 0;
  // No answer until the app stops waiting, as from a computer short of memory.
  const silent = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
  const refused = () => Promise.reject(new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8765'), { code: 'ECONNREFUSED' }) }));
  const jobs = (poll: (init: RequestInit) => Response | Promise<Response>) => (path: string, init: RequestInit) =>
    path === '/cutout' ? new Response(new Uint8Array(CUT)) : path.startsWith('/jobs?') ? Response.json({ id: 'job' }) : (polls++, poll(init));

  beforeEach(() => {
    process.env.PHOTO3D_GPU_URL = 'http://127.0.0.1:8765';
    Object.assign(timing, { gpuPollMs: 1, gpuAnswerMs: 50, limitMs: 2000 });
    polls = 0;
    vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit) => server(String(input).replace(process.env.PHOTO3D_GPU_URL!, ''), init));
  });
  afterEach(() => {
    delete process.env.PHOTO3D_GPU_URL;
    Object.assign(timing, defaults);
  });

  it('waits out a slow answer instead of giving up on the build', async () => {
    server = jobs((init) => (polls === 1 ? silent(init) : polls === 2 ? Response.json({ state: 'running', ahead: 0 }, { status: 202 }) : new Response(new Uint8Array(GLB))));
    const seen = await build(photo(), 'quick');
    expect(seen.map((e) => e.type)).toEqual(['id', 'cutout', 'step', 'done']);
    expect(polls).toBe(3);
    expect(await readAsset((seen[0] as { id: string }).id, 'quick')).toEqual(GLB);
  });

  it('says so at once when the server on this computer has stopped', async () => {
    server = jobs(refused);
    expect((await build(photo(), 'quick')).at(-1)).toMatchObject({ type: 'error', retry: true, message: expect.stringContaining("server on this computer isn't running") });
    expect(polls).toBe(1);
  });

  it('gives up at the time limit and stops asking', async () => {
    Object.assign(timing, { limitMs: 300 });
    server = jobs(silent);
    expect((await build(photo(), 'quick')).at(-1)).toMatchObject({ type: 'error', retry: true, message: expect.stringContaining('short of memory') });
    await sleep(150);
    const asked = polls;
    await sleep(150);
    expect(polls).toBe(asked);
  });

  it('keeps the notebook message for a server elsewhere', async () => {
    process.env.PHOTO3D_GPU_URL = 'https://example.trycloudflare.com';
    server = refused;
    expect((await build(photo(), 'quick')).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('notebook is still running') });
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
