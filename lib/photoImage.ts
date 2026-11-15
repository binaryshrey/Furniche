'use client';

// Browser-side photo handling for Photo to 3D: shrink a camera photo before upload, and make a
// small cut-out thumbnail for the piece's card.

const MAX_SIDE = 1536; // TRELLIS.2 and the cut-out model both work below this

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

const decode = (image: Blob) => createImageBitmap(image, { imageOrientation: 'from-image' }).catch(() => null);

// iPhone photos are HEIC, and stay HEIC when renamed to .jpeg, so the file's own header decides.
export async function isHeic(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(String.fromCharCode(...head.subarray(4, 12)));
}

// Upright (EXIF rotation applied) and at most MAX_SIDE pixels on its long side. Photos with
// transparency stay PNG; everything else becomes JPEG.
export async function preparePhoto(file: File): Promise<Blob> {
  let bitmap = await decode(file);
  if (!bitmap && (await isHeic(file))) {
    // Safari reads HEIC itself; elsewhere the server converts it (app/api/photo3d/convert).
    const body = new FormData();
    body.append('image', file, 'photo.heic');
    const res = await fetch('/api/photo3d/convert', { method: 'POST', body }).catch(() => null);
    if (!res) throw new Error('Could not reach the server to convert the photo.');
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'This photo could not be converted.');
    bitmap = await decode(await res.blob());
  }
  if (!bitmap) throw new Error("This photo can't be read. Use a JPEG, PNG or iPhone (HEIC) photo.");
  const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const c = canvas(bitmap.width * k, bitmap.height * k);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const alpha = file.type === 'image/png' || file.type === 'image/webp';
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, alpha ? 'image/png' : 'image/jpeg', 0.92));
  if (!blob) throw new Error('Could not prepare the photo.');
  return blob;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

// Width ÷ height of the piece in a cut-out (its non-transparent pixels).
export async function cutoutAspect(src: string): Promise<number | undefined> {
  try {
    const img = await loadImage(src);
    const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvas(img.naturalWidth * k, img.naturalHeight * k);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let [x0, y0, x1, y1] = [c.width, c.height, -1, -1];
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 128) continue;
      const p = (i - 3) / 4;
      const [x, y] = [p % c.width, Math.floor(p / c.width)];
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
    return x1 < 0 ? undefined : (x1 - x0 + 1) / (y1 - y0 + 1);
  } catch {
    return undefined;
  }
}

// A square thumbnail cropped to the piece (its non-transparent pixels), as a data URL small
// enough to keep with the product in localStorage.
export async function thumbnail(src: string, size = 160): Promise<string | undefined> {
  try {
    const img = await loadImage(src);
    const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
    const probe = canvas(img.naturalWidth * k, img.naturalHeight * k);
    const pctx = probe.getContext('2d', { willReadFrequently: true })!;
    pctx.drawImage(img, 0, 0, probe.width, probe.height);
    const { data } = pctx.getImageData(0, 0, probe.width, probe.height);
    let [x0, y0, x1, y1] = [probe.width, probe.height, -1, -1];
    for (let y = 0; y < probe.height; y++) {
      for (let x = 0; x < probe.width; x++) {
        if (data[(y * probe.width + x) * 4 + 3] < 24) continue;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) [x0, y0, x1, y1] = [0, 0, probe.width - 1, probe.height - 1];
    // Back to source pixels, with a little margin, fitted inside the square.
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0);
    const sx = Math.max(0, (x0 - pad) / k);
    const sy = Math.max(0, (y0 - pad) / k);
    const sw = Math.min(img.naturalWidth - sx, (x1 - x0 + 1 + 2 * pad) / k);
    const sh = Math.min(img.naturalHeight - sy, (y1 - y0 + 1 + 2 * pad) / k);
    const fit = size / Math.max(sw, sh);
    const out = canvas(size, size);
    out.getContext('2d')!.drawImage(img, sx, sy, sw, sh, (size - sw * fit) / 2, (size - sh * fit) / 2, sw * fit, sh * fit);
    return out.toDataURL('image/webp', 0.85);
  } catch {
    return undefined;
  }
}
