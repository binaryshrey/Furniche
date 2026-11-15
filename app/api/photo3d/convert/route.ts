import { NextResponse } from 'next/server';
import { heicToJpeg, isHeic } from '@/lib/heic';

// iPhone (HEIC) photos as JPEG, for the photo panel (lib/photoImage.ts).
const MAX_SIDE = 1536; // the panel never uses more

export async function POST(req: Request) {
  const image = (await req.formData().catch(() => null))?.get('image');
  if (!(image instanceof Blob) || !image.size || image.size > 30_000_000) return NextResponse.json({ error: 'Send one photo (30 MB at most).' }, { status: 400 });
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!isHeic(bytes)) return NextResponse.json({ error: 'That photo is not a HEIC photo.' }, { status: 415 });
  try {
    return new Response(new Uint8Array(await heicToJpeg(bytes, MAX_SIDE)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'This photo could not be converted. Try sharing it from the iPhone as JPEG.' }, { status: 422 });
  }
}
