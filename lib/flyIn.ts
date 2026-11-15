import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { tileKey } from './meshTile';
import type { Listing } from './types';
import { city3dManifest } from './vexcel';

// For a home opened by address (/space/<id> typed or reloaded): the search that brings it up on
// the home page's 3D city, or null when it is off the Vexcel mesh and there is nothing to fly into.
export async function flyQuery(sid: string): Promise<string | null> {
  try {
    const d = JSON.parse(await readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8')) as { homes: Listing[]; apartments: Listing[] };
    const l = [...d.apartments, ...d.homes].find((x) => x.sid === sid);
    if (!l || l.lat == null || l.lon == null) return null;
    const mesh = new Set(
      (await city3dManifest(15)).map((u) => u.match(/^tile\.glb\?zoom=15&tile-x=(\d+)&tile-y=(\d+)/)).filter((m): m is RegExpMatchArray => !!m).map((m) => `${m[1]},${m[2]}`),
    );
    if (!mesh.has(tileKey(l.lat, l.lon, 15))) return null;
    if (l.kind === 'apartment') return l.community ? `apartments in ${l.community}` : null;
    const street = l.address.replace(/^\d+\s+/, '').replace(/\s+(unit|apt|#).*$/i, '');
    return street ? `homes in ${street}` : null;
  } catch {
    return null;
  }
}
