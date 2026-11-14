import path from 'node:path';

// Disk caches (3D tiles, IKEA models and photos, pano faces). The project folder is read-only on
// Vercel, so there they live in /tmp (per instance, cleared on cold start).
export const cacheDir = (name: string) => path.join(process.env.VERCEL ? '/tmp/furniche-cache' : path.join(process.cwd(), '.cache'), name);
