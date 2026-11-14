import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Same-origin copy of a Matterport panorama face for WebGL textures. Only Matterport's CDN is
// allowed; files are cached on disk by their path (the query string is a signature that expires).
const CACHE = path.join(process.cwd(), '.cache', 'panos');

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('u') ?? '';
  let src: URL;
  try {
    src = new URL(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (src.protocol !== 'https:' || !/^cdn-\d+\.matterport\.com$/.test(src.hostname)) return new Response(null, { status: 400 });
  const file = path.join(CACHE, createHash('sha1').update(src.pathname).digest('hex') + '.jpg');
  let body: Buffer | null = await readFile(file).catch(() => null);
  if (!body) {
    const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return new Response(null, { status: 502 });
    body = Buffer.from(await res.arrayBuffer());
    await mkdir(CACHE, { recursive: true });
    await writeFile(file, body);
  }
  return new Response(new Uint8Array(body), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
}
