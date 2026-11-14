import type { Entry } from '@/components/sky/SkyView';
import { entryUrl } from './entrySkip';

// The sky-to-house flight's entry (start spot + 360° photo links) per home, fetched once and
// shared by hover-prefetch and click. The photo links are signed for ~5 minutes, so an entry
// older than 3 minutes is fetched again.
const FRESH_MS = 3 * 60 * 1000;
const entries = new Map<string, { at: number; entry: Promise<Entry | null> }>();

export function getEntry(sid: string): Promise<Entry | null> {
  const hit = entries.get(sid);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.entry;
  const entry = fetch(entryUrl(sid))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.faces?.length === 6 ? { faces: d.faces as string[], eyeHeight: d.eyeHeight as number } : null))
    .catch(() => null);
  entries.set(sid, { at: Date.now(), entry });
  return entry;
}

// On hover: fetch the entry and start downloading its six photos, so a click flies straight in.
// Same crossOrigin mode as three.js's TextureLoader, so it reuses these downloads.
export function preloadEntry(sid: string) {
  getEntry(sid).then((e) =>
    e?.faces.forEach((url) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
    }),
  );
}
