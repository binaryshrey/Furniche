import { SCAN_KINDS, SCAN_PROMPTS, type ScanKind } from './scanSizes';

// What a photographed piece is, in the browser, for free: Apple's MobileCLIP (via transformers.js,
// loaded from a CDN on first use, then cached by the browser) compares the cut-out with every kind
// in lib/scanSizes.ts. Only the image half (46 MB) runs for each photo. The kinds' text side ships
// worked out in public/photo3d/kinds.json (textVectors and packVectors, run once in a browser);
// when the table changes and the file no longer matches, the browser works it out once (a 170 MB
// download) and keeps it.

const TRANSFORMERS: string = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
export const KIND_MODEL = 'Xenova/mobileclip_s0';
const DTYPE = 'fp32'; // its 8-bit versions mistake a bottle for a sofa

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TF = any;
let lib: Promise<TF> | null = null;
const tf = (): Promise<TF> => (lib ??= import(/* webpackIgnore: true */ TRANSFORMERS));

let vision: Promise<{ processor: TF; model: TF; RawImage: TF }> | null = null;
function visionModel() {
  return (vision ??= tf().then(async (t) => ({
    processor: await t.AutoProcessor.from_pretrained(KIND_MODEL),
    model: await t.CLIPVisionModelWithProjection.from_pretrained(KIND_MODEL, { dtype: DTYPE }),
    RawImage: t.RawImage,
  })));
}

// Start loading while the photo is still being cut out, so the answer is ready with it.
export function warmUpRecognizer() {
  visionModel().catch(() => (vision = null));
  kindVectors().catch(() => (vectors = null));
}

const normalise = (v: Float32Array) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};

// The kinds' text vectors, in SCAN_KINDS order: each kind's prompts averaged.
export async function textVectors(names: string[], prompts: string[]): Promise<Float32Array[]> {
  const t = await tf();
  const tokenizer = await t.AutoTokenizer.from_pretrained(KIND_MODEL);
  const model = await t.CLIPTextModelWithProjection.from_pretrained(KIND_MODEL, { dtype: DTYPE });
  const texts = names.flatMap((n) => prompts.map((p) => p.replace('{}', n)));
  const rows: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 24) {
    const { text_embeds } = await model(tokenizer(texts.slice(i, i + 24), { padding: 'max_length', truncation: true }));
    const dim = text_embeds.dims[1];
    const data = text_embeds.data as Float32Array;
    for (let r = 0; r < text_embeds.dims[0]; r++) rows.push(normalise(data.slice(r * dim, (r + 1) * dim)));
  }
  return names.map((_, k) => {
    const sum = new Float32Array(rows[0].length);
    prompts.forEach((_, p) => rows[k * prompts.length + p].forEach((x, i) => (sum[i] += x)));
    return normalise(sum);
  });
}

type Shipped = { model: string; prompts: string[]; names: string[]; dim: number; vectors: string };
const STORE_KEY = 'furniche.photo3d.kinds';
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

let vectors: Promise<Float32Array[]> | null = null;
function kindVectors(): Promise<Float32Array[]> {
  return (vectors ??= (async () => {
    const names = SCAN_KINDS.map((k) => k.name);
    const fits = (s: Shipped | null) => !!s && s.model === KIND_MODEL && sameList(s.prompts, SCAN_PROMPTS) && sameList(s.names, names);
    const unpack = (s: Shipped) => {
      const bytes = Int8Array.from(atob(s.vectors), (c) => (c.charCodeAt(0) << 24) >> 24);
      return names.map((_, k) => normalise(Float32Array.from(bytes.subarray(k * s.dim, (k + 1) * s.dim), (x) => x / 127)));
    };
    const shipped: Shipped | null = await fetch('/photo3d/kinds.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (fits(shipped)) return unpack(shipped!);
    let kept: Shipped | null = null;
    try {
      kept = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    } catch {
      /* none kept */
    }
    if (fits(kept)) return unpack(kept!);
    const fresh = await textVectors(names, SCAN_PROMPTS);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(packVectors(fresh, names)));
    } catch {
      /* storage full or blocked: work it out again next time */
    }
    return fresh;
  })());
}

// Vectors as signed bytes in base64, as public/photo3d/kinds.json keeps them.
export function packVectors(list: Float32Array[], names: string[]): Shipped {
  const dim = list[0].length;
  const bytes = new Uint8Array(list.length * dim);
  list.forEach((v, k) => v.forEach((x, i) => (bytes[k * dim + i] = Math.max(-127, Math.min(127, Math.round(x * 127))) & 0xff)));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return { model: KIND_MODEL, prompts: SCAN_PROMPTS, names, dim, vectors: btoa(bin) };
}

export type Recognized = { kind: ScanKind; p: number; color: string };

// The kind of piece in a cut-out (a transparent PNG), how sure (0–1), and its main colour.
export async function recognize(cutoutUrl: string): Promise<Recognized | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = cutoutUrl;
  await img.decode();
  const k = Math.min(1, 384 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, c.width, c.height);
  // The piece's main colour, from its own pixels, before the background goes in.
  const px = g.getImageData(0, 0, c.width, c.height).data;
  let [r, gr, b, n] = [0, 0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    r += px[i];
    gr += px[i + 1];
    b += px[i + 2];
    n++;
  }
  const hex = (v: number) => Math.round(v / Math.max(n, 1)).toString(16).padStart(2, '0');
  const color = n ? `#${hex(r)}${hex(gr)}${hex(b)}` : '#9a8f80';
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, c.width, c.height);

  const [{ processor, model, RawImage }, kinds] = await Promise.all([visionModel(), kindVectors()]);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) return null;
  const { image_embeds } = await model(await processor(await RawImage.fromBlob(blob)));
  const v = normalise(Float32Array.from(image_embeds.data as Float32Array));
  const logits = kinds.map((t) => 100 * t.reduce((s, x, i) => s + x * v[i], 0));
  const top = Math.max(...logits);
  const exp = logits.map((l) => Math.exp(l - top));
  const sum = exp.reduce((s, x) => s + x, 0);
  const best = exp.indexOf(Math.max(...exp));
  return { kind: SCAN_KINDS[best], p: exp[best] / sum, color };
}
