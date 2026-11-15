// The files of a photo piece (its cut-out and its 3D model) are kept in this browser, so they still
// load after a reload where the server keeps nothing between requests: Vercel's functions don't
// share a disk, and a GPU server on this computer keeps nothing at all. The server's copy
// (/api/photo3d/<id>/<asset>) is the fallback, for pieces built before this.
export type PhotoAsset = 'cutout' | 'quick' | 'detail';

const DB = 'furniche-photo3d';
const STORE = 'assets';
const urls = new Map<string, string>(); // object URLs made this session, by `${id}.${asset}`
let opened: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  return (opened ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = req.onblocked = () => resolve(null);
    } catch {
      resolve(null); // no IndexedDB (a private window in some browsers): the session's URLs still work
    }
  }));
}

function ask<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return db().then(
    (d) =>
      d &&
      new Promise<T | null>((resolve) => {
        try {
          const req = op(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

// Keeps a file; it can be shown at once, even if storing it fails.
export async function keepAsset(id: string, asset: PhotoAsset, data: Blob): Promise<void> {
  const key = `${id}.${asset}`;
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(data));
  await ask('readwrite', (s) => s.put(data, key));
}

// A file sent in a progress event, as base64.
export const fromBase64 = (b64: string, type: string): Promise<Blob> => fetch(`data:${type};base64,${b64}`).then((r) => r.blob());

export async function hasStoredAsset(id: string, asset: PhotoAsset): Promise<boolean> {
  return urls.has(`${id}.${asset}`) || (await ask('readonly', (s) => s.count(`${id}.${asset}`))) === 1;
}

// Where to load a file from: this browser's copy, or the server's.
export async function assetUrl(id: string, asset: PhotoAsset): Promise<string> {
  const key = `${id}.${asset}`;
  const known = urls.get(key);
  if (known) return known;
  const blob = await ask<Blob>('readonly', (s) => s.get(key));
  if (!(blob instanceof Blob)) return `/api/photo3d/${id}/${asset}`;
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  return url;
}
