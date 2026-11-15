import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { NextResponse } from 'next/server';

// iPhone photos are HEIC. Chrome and Firefox can't decode them, and the HDR photos of recent
// iPhones defeat in-browser decoders as well, so on a Mac the system's own converter (sips)
// turns them into a JPEG for the photo panel.
const run = promisify(execFile);
const MAX_SIDE = 1536; // the panel never uses more (lib/photoImage.ts)

export async function POST(req: Request) {
  const image = (await req.formData().catch(() => null))?.get('image');
  if (!(image instanceof Blob) || !image.size || image.size > 30_000_000) return NextResponse.json({ error: 'Send one photo (30 MB at most).' }, { status: 400 });
  const bytes = Buffer.from(await image.arrayBuffer());
  if (!/^ftyp(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(bytes.toString('latin1', 4, 12))) {
    return NextResponse.json({ error: 'That photo is not a HEIC photo.' }, { status: 415 });
  }
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: "This server can't convert iPhone (HEIC) photos. Share the photo as JPEG, or set the iPhone's camera format to Most Compatible." },
      { status: 501 },
    );
  }
  const base = path.join(os.tmpdir(), `furniche-photo-${randomUUID()}`);
  try {
    await writeFile(`${base}.heic`, bytes);
    await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', '-Z', String(MAX_SIDE), `${base}.heic`, '--out', `${base}.jpg`], { timeout: 20_000 });
    return new Response(new Uint8Array(await readFile(`${base}.jpg`)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'This photo could not be converted. Try sharing it from the iPhone as JPEG.' }, { status: 422 });
  } finally {
    await Promise.all([rm(`${base}.heic`, { force: true }), rm(`${base}.jpg`, { force: true })]);
  }
}
