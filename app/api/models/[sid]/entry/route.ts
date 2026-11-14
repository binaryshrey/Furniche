import { NextResponse } from 'next/server';
import { entryPano } from '@/lib/fit';
import { getModelGeometry, panoSkybox } from '@/lib/matterport';

// Where the tour opens and the 360° photo there, so the sky-to-house flight can end inside the
// real room before the tour has loaded. The faces are Matterport CDN links: edge-cached, CORS
// enabled for any origin, but signed for only ~5 minutes, so they're fetched fresh each time.
export async function GET(req: Request, { params }: { params: { sid: string } }) {
  try {
    const geometry = await getModelGeometry(params.sid);
    const skip = new Set((new URL(req.url).searchParams.get('skip') ?? '').split(',').filter(Boolean));
    const pano = entryPano(geometry, skip);
    if (!pano) return NextResponse.json({ error: 'No panoramas' }, { status: 404 });
    // The empty (defurnished) room when the model has one, which is what the tour shows.
    const faces = (geometry.defurnishedViewId && (await panoSkybox(geometry.defurnishedViewId, pano.id).catch(() => null))) || (await panoSkybox(params.sid, pano.id));
    const floor = geometry.rooms.find((r) => r.floorId === pano.floorId)?.floorZ ?? geometry.floors[0]?.z ?? 0;
    return NextResponse.json(
      {
        panoId: pano.id,
        eyeHeight: pano.pos.z - floor, // camera height above its floor
        faces: faces ?? null,
      },
      { headers: { 'Cache-Control': 'private, max-age=60' } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
