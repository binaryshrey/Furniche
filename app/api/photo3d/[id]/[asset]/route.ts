import { imageType, isPhotoId, readAsset } from '@/lib/photo3d';

// A finished model (quick or detail GLB) or the photo's cut-out. Ids are content hashes, so a
// file never changes once it exists.
const ASSETS = ['quick', 'detail', 'cutout'] as const;

export async function GET(_req: Request, { params }: { params: { id: string; asset: string } }) {
  const asset = ASSETS.find((a) => a === params.asset);
  if (!isPhotoId(params.id) || !asset) return new Response(null, { status: 404 });
  const buf = await readAsset(params.id, asset);
  if (!buf) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': asset === 'cutout' ? imageType(buf) : 'model/gltf-binary', 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
