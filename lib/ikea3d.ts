import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// IKEA publishes a real-scale, textured GLB (Draco) for many products, linked from the product
// page (web-api.ikea.com/dimma/assets/...). We find the page, read that link, download the file
// once and cache it on disk. Reuse is agreed with IKEA for this project.

const CACHE = path.join(process.cwd(), '.cache', 'models');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PRODUCT_PAGE = /^https:\/\/www\.ikea\.com\/[a-z]{2}\/[a-z]{2}\/p\/[a-z0-9-]+\/?$/i;
const GLB_LINK = /https:\/\/web-api\.ikea\.com\/dimma\/assets\/[^"'\\\s]+\.glb(?:\?[^"'\\\s]*)?/;

async function text(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json' }, signal: AbortSignal.timeout(12000) });
  return res.ok ? res.text() : null;
}

// Catalogue items carry an IKEA search link, so look the product page up by name.
async function productPage(url: string, name: string): Promise<string | null> {
  if (PRODUCT_PAGE.test(url)) return url;
  const q = encodeURIComponent(name.replace(/,/g, ' ').slice(0, 100));
  const body = await text(`https://sik.search.blue.cdtapps.com/us/en/search-result-page?q=${q}&size=1&types=PRODUCT`);
  try {
    const pip: string | undefined = body ? JSON.parse(body).searchResultPage?.products?.main?.items?.[0]?.product?.pipUrl : undefined;
    return pip && PRODUCT_PAGE.test(pip) ? pip : null;
  } catch {
    return null;
  }
}

export async function ikeaModel(id: string, url: string, name: string): Promise<Buffer | null> {
  const file = path.join(CACHE, `${id}.glb`);
  const miss = path.join(CACHE, `${id}.none`);
  try {
    return await readFile(file);
  } catch {
    /* not cached yet */
  }
  try {
    await readFile(miss);
    return null; // looked before and IKEA has no model for it
  } catch {
    /* not looked yet */
  }

  await mkdir(CACHE, { recursive: true });
  const page = await productPage(url, name);
  const link = page ? (await text(page))?.match(GLB_LINK)?.[0] : null;
  if (!link) {
    await writeFile(miss, '');
    return null;
  }
  const res = await fetch(link, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const glb = Buffer.from(await res.arrayBuffer());
  await writeFile(file, glb);
  return glb;
}

// A photo of the product for thumbnails: IKEA's lifestyle shot (the piece styled in a real,
// lit room, so fabric, wood grain and sheen read like a photograph), else its studio cut-out.
// Cached on disk like the models; `null` (also cached) when IKEA has no match.
const IMAGES = path.join(process.cwd(), '.cache', 'images-room');
export async function ikeaImage(id: string, name: string): Promise<Buffer | null> {
  const file = path.join(IMAGES, `${id}.jpg`);
  const miss = path.join(IMAGES, `${id}.none`);
  try {
    return await readFile(file);
  } catch {
    /* not cached yet */
  }
  try {
    await readFile(miss);
    return null;
  } catch {
    /* not looked yet */
  }
  await mkdir(IMAGES, { recursive: true });
  const q = encodeURIComponent(name.replace(/,/g, ' ').slice(0, 100));
  const body = await text(`https://sik.search.blue.cdtapps.com/us/en/search-result-page?q=${q}&size=1&types=PRODUCT`);
  let src: string | undefined;
  try {
    const prod = body ? JSON.parse(body).searchResultPage?.products?.main?.items?.[0]?.product : undefined;
    src = prod?.contextualImageUrl ?? prod?.mainImageUrl;
  } catch {
    /* unexpected response */
  }
  if (!src || !/^https:\/\/www\.ikea\.com\//.test(src)) {
    await writeFile(miss, '');
    return null;
  }
  const res = await fetch(src.replace(/_s5\.jpg$/, '_s4.jpg'), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) return null;
  const img = Buffer.from(await res.arrayBuffer());
  await writeFile(file, img);
  return img;
}
