'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { CATEGORY_LABEL, PRODUCTS } from '@/catalog/products';
import type { Engine, PhotoEvent } from '@/lib/photo3d';
import { cutoutAspect, preparePhoto, thumbnail } from '@/lib/photoImage';
import { type Axis, extentsAt, knownAxis, scaledDims, squareAngle, typicalCm } from '@/lib/photoSize';
import { placeFree } from '@/lib/designOps';
import { useStore } from '@/lib/store';
import type { Category, ModelGeometry, Product, Room } from '@/lib/types';
import ProductSwatch from '../shop/ProductSwatch';
import { loadPhotoScene, photoModelUrl, scenePoints } from '../viewer/RealModel';

// Photo to 3D: a photo of a piece becomes a textured 3D model at true size, dragged into the room
// like any product. Built for free (lib/photo3d.ts): on your own GPU when one is connected, with no
// daily limits; otherwise on Hugging Face's shared GPUs, a few models a day. Claude names the piece and estimates its size when an
// Anthropic key is set; otherwise the shopper picks the type and the size starts from the catalogue.

const ModelPreview = dynamic(() => import('./ModelPreview'), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-panel" /> });

type Guess = { name: string; category: Category; color: string; dimsCm: Record<Axis, number | null>; confidence: 'high' | 'medium' | 'low' };
type Shown = { engine: Engine; scene: THREE.Object3D; points: Float32Array; square: number };
type Progress = { cutout: boolean; queue: { position: number; eta: number | null } | null; fraction: number | null };

const IDLE: Progress = { cutout: false, queue: null, fraction: null };
const WALL: Category[] = ['mirror', 'wall-art'];
const ENGINE_LABEL: Record<Engine, string> = { quick: 'Quick', detail: 'Max detail' };
const TURN = Math.PI / 2;
// HEIC photos can come without an image/ type, so their name counts too.
const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);

// The server's progress events, one JSON object per line.
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<PhotoEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    buf += decoder.decode(value, { stream: !done });
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line) as PhotoEvent;
    }
    if (done) return;
  }
}

function Step({ state, label, note }: { state: 'waiting' | 'active' | 'done'; label: string; note?: string }) {
  return (
    <li className="flex items-center gap-2">
      {state === 'done' ? (
        <span className="grid h-4 w-4 place-items-center rounded-full bg-ok/20 text-[10px] text-ok">✓</span>
      ) : state === 'active' ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
      ) : (
        <span className="h-4 w-4 rounded-full border-2 border-line" />
      )}
      <span className={state === 'waiting' ? 'text-muted' : ''}>{label}</span>
      {note && <span className="num ml-auto text-muted">{note}</span>}
    </li>
  );
}

function progressNote(p: Progress): string | undefined {
  if (p.queue) return `waiting for a free GPU · ${p.queue.position} ahead${p.queue.eta ? ` · ~${Math.ceil(p.queue.eta)} s` : ''}`;
  if (p.fraction != null) return `${Math.round(p.fraction * 100)}%`;
  return undefined;
}

// Pieces go into the room like the Furniture tab's: into an open spot of the room you're in, or,
// with no room or no spot, onto the floor you click next.
export default function PhotoTo3D({ room = null, geometry = null, onAdded }: { room?: Room | null; geometry?: ModelGeometry | null; onAdded?: (p: Product, placed: boolean) => void } = {}) {
  const [config, setConfig] = useState<{ token: boolean; identify: boolean; gpu: boolean } | null>(null);
  const [engine, setEngine] = useState<Engine>('quick');
  const [photo, setPhoto] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<Progress>(IDLE);
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [turns, setTurns] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [nameText, setNameText] = useState<string | null>(null);
  const [categoryChoice, setCategoryChoice] = useState<Category | null>(null);
  const [userMeasure, setUserMeasure] = useState<{ axis: Axis; cm: number } | null>(null);
  const [editing, setEditing] = useState<{ axis: Axis; text: string } | null>(null);
  const [price, setPrice] = useState('');
  const [thumb, setThumb] = useState<string | undefined>();
  const [aspect, setAspect] = useState<number | null>(null); // the cut-out's width ÷ height
  const [placedId, setPlacedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const run = useRef(0); // bumped for every build; stale async work checks it and stops
  const abort = useRef<AbortController | null>(null);
  const source = useRef<File | null>(null);
  const photoUrl = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mine = useStore((s) => s.importedProducts).filter((p) => p.source === 'photo');
  const pending = useStore((s) => s.pendingProductId);

  useEffect(() => {
    fetch('/api/photo3d')
      .then((r) => r.json())
      .then((c) => {
        setConfig(c);
        if (c?.gpu) setEngine('quick'); // your own GPU or this computer: one quick model, nothing to choose
      })
      .catch(() => setConfig(null));
  }, []);

  function reset() {
    run.current += 1;
    abort.current?.abort();
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = null;
    source.current = null;
    setPhoto(null);
    setId(null);
    setBuilding(false);
    setProgress(IDLE);
    setError(null);
    setShown(null);
    setTurns(0);
    setReadyAt(null);
    setGuess(null);
    setNameText(null);
    setCategoryChoice(null);
    setUserMeasure(null);
    setEditing(null);
    setPrice('');
    setThumb(undefined);
    setAspect(null);
    setPlacedId(null);
  }

  async function identify(image: Blob, token: number) {
    const body = new FormData();
    body.append('image', image, 'photo');
    const json = await fetch('/api/photo3d/identify', { method: 'POST', body })
      .then((r) => r.json())
      .catch(() => null);
    if (token === run.current && json?.guess) setGuess(json.guess);
  }

  // Builds a model of `file` with `which`. `again`: the same photo once more (another engine, or a
  // retry), keeping the name, type and size, and any model on show until the new one is in.
  async function begin(file: File, which: Engine, again = false) {
    if (!again) reset();
    const token = ++run.current;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    source.current = file;
    setEngine(which);
    setBuilding(true);
    setProgress(IDLE);
    setError(null);
    setStartedAt(performance.now());
    setNow(performance.now());
    setReadyAt(null);
    const fail = (message: string, retry = true) => {
      if (token !== run.current) return;
      setError({ message, retry });
      setBuilding(false);
    };

    let image: Blob;
    try {
      image = await preparePhoto(file);
    } catch (e) {
      return fail((e as Error).message);
    }
    if (token !== run.current) return;
    if (!again) {
      const url = URL.createObjectURL(image);
      photoUrl.current = url;
      setPhoto(url);
      identify(image, token);
    }

    const body = new FormData();
    body.append('image', image, image.type === 'image/png' ? 'photo.png' : 'photo.jpg');
    body.append('engine', which);
    const res = await fetch('/api/photo3d', { method: 'POST', body, signal: ctrl.signal }).catch(() => null);
    if (token !== run.current) return;
    if (!res?.ok || !res.body) return fail((await res?.json().catch(() => null))?.error ?? 'Could not reach the server.');
    let photoId: string | null = null;
    let built = false;
    try {
      for await (const e of events(res.body)) {
        if (token !== run.current) return;
        if (e.type === 'id') {
          photoId = e.id;
          setId(e.id);
        } else if (e.type === 'cutout' && photoId) {
          setProgress((p) => ({ ...p, cutout: true }));
          thumbnail(`/api/photo3d/${photoId}/cutout`).then((t) => token === run.current && t && setThumb(t));
          cutoutAspect(`/api/photo3d/${photoId}/cutout`).then((a) => token === run.current && a && setAspect(a));
        } else if (e.type === 'queue') setProgress((p) => ({ ...p, queue: { position: e.position, eta: e.eta } }));
        else if (e.type === 'step') setProgress((p) => ({ ...p, queue: null, fraction: e.fraction }));
        else if (e.type === 'error') return fail(e.message, e.retry);
        else if (e.type === 'done') built = true;
      }
    } catch {
      return fail('The connection to the server dropped. Try again.');
    }
    if (!built || !photoId) return fail('The connection to the server dropped. Try again.');

    try {
      const scene = await loadPhotoScene(photoModelUrl({ id: photoId, engine: which }));
      if (token !== run.current) return;
      const points = scenePoints(scene);
      const square = squareAngle(points);
      setShown({ engine: which, scene, points, square: Math.abs(square) < 0.035 ? 0 : square });
      setTurns(0);
      setReadyAt(performance.now());
      setBuilding(false);
    } catch {
      fail('The model arrived but could not be opened.');
    }
  }

  // Paste a photo anywhere in the editor.
  const beginRef = useRef(begin);
  beginRef.current = begin;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find(isImage);
      if (!file || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
      e.preventDefault();
      beginRef.current(file, engineRef.current);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [building]);

  // What the piece is and how big: the shopper's answers first, then Claude's, then defaults.
  const category = categoryChoice ?? guess?.category ?? 'armchair';
  const name = nameText ?? guess?.name ?? '';
  const measure = useMemo(() => {
    if (userMeasure) return { ...userMeasure, source: 'you' as const };
    const axis = knownAxis(category);
    const seen = guess?.category === category ? guess.dimsCm[axis] : null;
    return seen ? { axis, cm: seen, source: 'photo' as const } : { axis, cm: typicalCm(category, axis, PRODUCTS), source: 'typical' as const };
  }, [userMeasure, category, guess]);
  const yaw = shown ? ((((shown.square + turns * TURN) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) : 0;
  const extents = useMemo(() => (shown ? extentsAt(shown.points, yaw) : null), [shown, yaw]);
  // Before the model is in, the cut-out's proportions stand in (a thin card), so it can already go in the room.
  const dims = extents ? scaledDims(extents, measure.axis, measure.cm) : aspect && progress.cutout ? scaledDims({ x: aspect, y: 1, z: aspect * 0.08 }, measure.axis, measure.cm) : null;

  const product = useMemo<Product | null>(() => {
    if (!id || !dims || (!shown && !aspect)) return null;
    return {
      id: `photo-${id}`,
      source: 'photo',
      retailer: 'other',
      name: name.trim() || 'Piece from your photo',
      url: '',
      imageUrl: thumb,
      priceUsd: Math.max(0, Number(price) || 0),
      priceCheckedAt: new Date().toISOString().slice(0, 10),
      category,
      dimsCm: dims,
      color: guess?.color ?? '#9a8f80',
      styles: [],
      placement: WALL.includes(category) ? 'wall' : 'floor',
      standIn: false,
      photoModel: shown ? { id, engine: shown.engine, yaw } : { id, engine, yaw: 0, standee: true },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shown, aspect, engine, dims?.w, dims?.d, dims?.h, name, thumb, price, category, guess?.color, yaw]);

  // Once placed, the piece in the room follows every change here: size, name, facing, and a
  // rebuild in Max detail.
  useEffect(() => {
    if (placedId && product) useStore.getState().addImportedProduct(product);
  }, [placedId, product]);

  function addToRoom(p: Product) {
    const st = useStore.getState();
    if (room && geometry && p.placement !== 'wall') {
      const d = st.design();
      const spot = placeFree(p, room, { items: d.items, surfaces: d.surfaces, doors: d.doors, themeId: d.themeId }, { geometry, products: st.products() });
      if (spot) {
        st.addItem(p.id, spot.pos, spot.roomId, spot.rot);
        return onAdded?.(p, true);
      }
    }
    st.setPending(p.id);
    onAdded?.(p, false);
  }

  function place() {
    if (!product) return;
    useStore.getState().addImportedProduct(product);
    setPlacedId(product.id);
    addToRoom(product);
  }

  const seconds = Math.max(0, ((readyAt ?? now) - startedAt) / 1000);
  const choose = () => fileInput.current?.click();
  const retry = (which: Engine) => source.current && begin(source.current, which, true);
  const own = !!config?.gpu; // your own GPU server (this computer or a notebook): one quick model, no limits
  const detailHint = 'About a minute, and it uses most of a free day\'s GPU allowance';

  return (
    <section className="rounded-2xl border border-line bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-display text-base">Photo to 3D</h3>
        {photo && !error && <span className="num text-[11px] text-muted">{building ? `${seconds.toFixed(0)} s` : readyAt ? `built in ${seconds.toFixed(0)} s` : ''}</span>}
      </div>
      <input
        ref={fileInput}
        id="photo3d-file"
        type="file"
        accept="image/*,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) begin(f, engine);
        }}
      />

      {!photo && !error && (
        <>
          <div className={`mb-2 grid grid-cols-2 gap-1 rounded-lg border border-line bg-paper p-0.5 text-xs ${own ? 'hidden' : ''}`} role="radiogroup" aria-label="Model quality">
            {(['quick', 'detail'] as Engine[]).map((e) => (
              <button
                key={e}
                role="radio"
                aria-checked={engine === e}
                onClick={() => setEngine(e)}
                title={config?.gpu ? (e === 'quick' ? 'Hunyuan3D-2 on your GPU, lighter settings' : 'Hunyuan3D-2 on your GPU, full detail') : e === 'quick' ? 'Stable Fast 3D: a few seconds' : `TRELLIS: ${detailHint}`}
                className={`rounded-md px-2 py-1.5 ${engine === e ? 'bg-ink text-paper' : 'text-muted hover:text-ink'}`}
              >
                {ENGINE_LABEL[e]}
              </button>
            ))}
          </div>
          <button
            onClick={choose}
            disabled={building}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = Array.from(e.dataTransfer.files).find(isImage);
              if (f) begin(f, engine);
            }}
            className={`flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-4 text-center transition ${dragOver ? 'border-brand bg-brand/10' : 'border-ink/30 hover:bg-panel'}`}
          >
            {building ? (
              <>
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                <span className="text-sm font-medium">Reading the photo…</span>
              </>
            ) : (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span className="text-sm font-medium">Add a photo of a piece</span>
                <span className="text-[11px] text-muted">Take one, choose one, drop or paste it here. iPhone photos work as they are.</span>
              </>
            )}
          </button>
          <p className="mt-2 text-[11px] leading-snug text-muted">
            {own
              ? 'A textured 3D model of the piece, built on your own GPU with no daily limits. It can go in the room as soon as the cut-out appears.'
              : `${engine === 'quick' ? 'Quick: a textured 3D model in a few seconds.' : `Max detail: finer shape and textures. ${detailHint}.`} Free on Hugging Face's shared GPUs, a few models a day${config && !config.token ? ' (more with a free HF_TOKEN)' : ''}.`}{' '}
            Every model is kept. Best with one piece, all of it in frame, shot from the side against a plain background.
          </p>
        </>
      )}

      {error && !shown && (
        <div className="space-y-2">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-24 w-full rounded-lg object-cover opacity-60" />
          )}
          <p className={`text-xs ${error.retry ? 'text-bad' : 'text-warn'}`}>{error.message}</p>
          <div className="flex flex-wrap gap-2">
            {source.current && engine === 'detail' && (
              <button onClick={() => retry('quick')} className="rounded-lg btn-brand px-3 py-1.5 text-xs font-semibold">
                Use Quick instead
              </button>
            )}
            {source.current && error.retry && (
              <button onClick={() => retry(engine)} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink/40">
                Try again
              </button>
            )}
            <button onClick={reset} className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-ink/40">
              Another photo
            </button>
          </div>
        </div>
      )}

      {photo && !error && !shown && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Your photo" className="aspect-square w-full rounded-lg bg-panel object-cover" />
            <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-panel">
              {progress.cutout && id ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/photo3d/${id}/cutout`} alt="The piece, cut out" className="h-full w-full object-contain p-1" />
              ) : (
                <div className="h-full w-full animate-pulse" />
              )}
            </div>
          </div>
          <ul className="space-y-1.5 text-xs">
            <Step state={progress.cutout ? 'done' : 'active'} label="Cut the piece out of the photo" />
            <Step state={progress.cutout ? 'active' : 'waiting'} label={own ? 'Build the 3D model' : `Build the 3D model (${ENGINE_LABEL[engine]})`} note={progress.cutout ? progressNote(progress) : undefined} />
          </ul>
          {product && (
            <button onClick={place} className="w-full rounded-lg btn-brand px-3 py-2 text-sm font-semibold">
              {placedId ? 'Add another to the room' : 'Add to the room now'}
            </button>
          )}
          {product && <p className="text-[11px] text-muted">It shows as the photo until the 3D model is ready, then turns 3D by itself.</p>}
          <p className="text-[11px] text-muted">
            {guess ? `Looks like: ${guess.name}.` : own ? 'Add it to the room now if you like: it turns 3D by itself when the model is ready.' : engine === 'quick' ? 'Usually a few seconds; longer if the free GPUs are busy.' : 'Usually about a minute; longer if the free GPUs are busy.'}
          </p>
          <button onClick={reset} className="text-[11px] text-muted underline hover:text-ink">
            Cancel
          </button>
        </div>
      )}

      {shown && dims && product && (
        <div className="space-y-2.5">
          <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-panel">
            <ModelPreview source={shown.scene} yaw={yaw} />
            <button
              onClick={() => setTurns((t) => (t + 1) % 4)}
              title="Turn the piece so its front faces the arrow"
              className="absolute bottom-2 right-2 rounded-full border border-line bg-paper/85 px-2.5 py-1 text-[11px] backdrop-blur hover:border-ink/40"
            >
              ↻ Turn 90°
            </button>
            {!own && <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-paper/80 px-2 py-0.5 text-[10px] text-muted backdrop-blur">{ENGINE_LABEL[shown.engine]}</span>}
          </div>
          <p className="text-[11px] text-muted">Drag to look around. The red arrow marks the front; turn the piece until it matches.</p>
          {building ? (
            <p className="flex items-center gap-2 text-[11px]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
              {own ? 'Building the 3D model…' : `Building in ${ENGINE_LABEL[engine]}…`} <span className="num text-muted">{progressNote(progress) ?? `${seconds.toFixed(0)} s`}</span>
            </p>
          ) : error ? (
            <p className={`text-[11px] ${error.retry ? 'text-bad' : 'text-warn'}`}>{error.message}</p>
          ) : (
            shown.engine === 'quick' &&
            !own && (
              <button onClick={() => retry('detail')} className="text-left text-[11px] text-muted underline hover:text-ink">
                Want finer detail? Rebuild it in Max detail (about a minute).
              </button>
            )
          )}

          <input
            id="photo3d-name"
            value={name}
            onChange={(e) => setNameText(e.target.value)}
            placeholder="Name this piece"
            className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-sm font-medium"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-[11px] text-muted">
              Type
              <select
                id="photo3d-category"
                value={category}
                onChange={(e) => setCategoryChoice(e.target.value as Category)}
                className="mt-0.5 rounded-lg border border-line bg-paper px-1.5 py-1.5 text-sm text-ink"
              >
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-[11px] text-muted">
              Price (optional)
              <input
                id="photo3d-price"
                type="number"
                min={0}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="$"
                className="num mt-0.5 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink"
              />
            </label>
          </div>
          <div>
            <div className="flex items-baseline justify-between text-[11px] text-muted">
              <span>Size (cm)</span>
              <span className={measure.source === 'you' ? 'text-ok' : 'text-warn'}>
                {measure.source === 'you' ? 'your measurement' : measure.source === 'photo' ? `estimated from the photo${guess ? ` · ${guess.confidence} confidence` : ''}` : 'typical size, please check'}
              </span>
            </div>
            <div className="mt-0.5 grid grid-cols-3 gap-2">
              {(['w', 'd', 'h'] as Axis[]).map((a) => (
                <label key={a} className="flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-muted">
                  {a.toUpperCase()}
                  <input
                    id={`photo3d-${a}`}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={editing?.axis === a ? editing.text : dims[a]}
                    onChange={(e) => {
                      setEditing({ axis: a, text: e.target.value });
                      const v = parseFloat(e.target.value);
                      if (v > 0 && v < 2000) setUserMeasure({ axis: a, cm: v });
                    }}
                    onBlur={() => setEditing(null)}
                    className="num w-full min-w-0 bg-transparent text-sm text-ink outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted">Know one measurement? Type it and the others follow the model&apos;s shape.</p>
          </div>

          <button
            onClick={place}
            aria-pressed={pending === product.id}
            className={`flex w-full items-center justify-center gap-2 rounded-lg btn-brand px-3 py-2.5 text-sm font-semibold ${pending === product.id ? 'ring-2 ring-ink' : ''}`}
          >
            {placedId ? 'Add another to the room' : 'Add to the room'}
          </button>
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>{placedId ? 'Changes here update the pieces in the room.' : room ? `Goes into the ${room.label.toLowerCase()}.` : 'Then click the floor where it goes.'}</span>
            <button onClick={reset} className="underline hover:text-ink">
              New photo
            </button>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <h4 className="eyebrow mb-2">Your pieces</h4>
          <ul className="space-y-1.5">
            {mine.map((p) => (
              <li key={p.id} className={`flex items-center gap-2 rounded-xl border bg-paper p-1.5 ${pending === p.id ? 'border-ink' : 'border-line'}`}>
                <button onClick={() => addToRoom(p)} title="Add to the room" className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ProductSwatch product={p} size={36} />
                  <div className="min-w-0 text-xs">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="num truncate text-[11px] text-muted">
                      {p.dimsCm.w} × {p.dimsCm.d} × {p.dimsCm.h} cm{p.photoModel && !own ? ` · ${ENGINE_LABEL[p.photoModel.engine]}` : ''}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (p.id === placedId) setPlacedId(null);
                    useStore.getState().removeImportedProduct(p.id);
                  }}
                  aria-label={`Delete ${p.name}`}
                  title="Delete this piece and remove it from the room"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted hover:bg-card hover:text-ink"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
