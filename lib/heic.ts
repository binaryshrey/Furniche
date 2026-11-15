import 'server-only';
import decode from 'heic-decode';
import jpeg from 'jpeg-js';

// iPhone photos are HEIC. Chrome and Firefox can't decode them, and the HDR photos of recent iPhones
// defeat in-browser decoders as well, so the server turns them into a JPEG for the photo panel, with
// libheif compiled to WebAssembly: it runs on any server, Vercel's included.
export const isHeic = (bytes: Uint8Array) => /^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(Buffer.from(bytes.subarray(4, 12)).toString('latin1'));

type Pixels = { width: number; height: number; data: Uint8ClampedArray };

// The longer side at most `max`: each new pixel averages the pixels it covers.
export function shrink({ width, height, data }: Pixels, max: number): Pixels {
  const k = Math.min(1, max / Math.max(width, height));
  if (k === 1) return { width, height, data };
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
      const sum = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let i = (sy * width + x0) * 4, end = (sy * width + x1) * 4; i < end; i += 4) {
          sum[0] += data[i];
          sum[1] += data[i + 1];
          sum[2] += data[i + 2];
          sum[3] += data[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      out.set(sum.map((v) => v / n), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

export async function heicToJpeg(bytes: Uint8Array, maxSide: number): Promise<Buffer> {
  const { width, height, data } = shrink(await decode({ buffer: bytes }), maxSide);
  return jpeg.encode({ width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) }, 92).data;
}
