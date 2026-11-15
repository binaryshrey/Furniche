// Downloads the git-ignored data/ folder (floor plans, listings) before the build, so Git-triggered
// Vercel deploys work. It does nothing when data/ is already there (local dev, CLI deploys).
//
// Where the archive comes from (first match wins):
//   1. Vercel Blob (private store): set up by `vercel blob create-store`, which adds
//      BLOB_READ_WRITE_TOKEN to the project. Read with the @vercel/blob SDK.
//      DATA_BLOB_PATH picks the file (default data/furniche-data.tar.gz).
//   2. Any URL: DATA_ARCHIVE_URL, with optional DATA_ARCHIVE_TOKEN sent as a Bearer token.
// DATA_ARCHIVE_SHA256 (optional) is the archive's sha256; the build fails if it differs.
// Make the archive with scripts/pack-data.sh.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const onVercel = !!process.env.VERCEL;

const hasData = () => existsSync(path.join(dataDir, 'listings.json')) && existsSync(path.join(dataDir, 'geometry')) && readdirSync(path.join(dataDir, 'geometry')).length > 0;

function fail(msg) {
  console.error(`fetch-data: ${msg}`);
  process.exit(1);
}

if (hasData()) {
  console.log('fetch-data: data/ is already present, nothing to download.');
  process.exit(0);
}

const url = process.env.DATA_ARCHIVE_URL;
const blobPath = process.env.DATA_BLOB_PATH || 'data/furniche-data.tar.gz';
const useBlob = !url && !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
if (!url && !useBlob) {
  if (onVercel) fail('data/ is missing. Connect a Vercel Blob store holding the archive, or set DATA_ARCHIVE_URL in the Vercel project environment variables.');
  console.warn('fetch-data: data/ is missing and no Blob store or DATA_ARCHIVE_URL is set; skipping (set one, or add data/ by hand).');
  process.exit(0);
}

let buf;
if (useBlob) {
  console.log(`fetch-data: reading ${blobPath} from Vercel Blob…`);
  const { get } = await import('@vercel/blob');
  const r = await get(blobPath, { access: 'private' });
  if (!r || r.statusCode !== 200) fail(`${blobPath} was not found in the Blob store.`);
  buf = Buffer.from(await new Response(r.stream).arrayBuffer());
} else {
  const headers = process.env.DATA_ARCHIVE_TOKEN ? { Authorization: `Bearer ${process.env.DATA_ARCHIVE_TOKEN}` } : {};
  console.log('fetch-data: downloading the data archive…');
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) fail(`download failed: HTTP ${res.status} ${res.statusText}`);
  buf = Buffer.from(await res.arrayBuffer());
}

const want = process.env.DATA_ARCHIVE_SHA256?.trim().toLowerCase();
if (want) {
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== want) fail(`checksum mismatch: expected ${want}, got ${got}`);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'furniche-data-'));
const file = path.join(tmp, 'data.tar.gz');
writeFileSync(file, buf);
const tar = spawnSync('tar', ['-xzf', file, '-C', root], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (tar.status !== 0) fail('could not unpack the archive (it must contain a top-level data/ folder).');
if (!hasData()) fail('the archive unpacked but data/listings.json or data/geometry is missing.');
console.log(`fetch-data: ready (${readdirSync(path.join(dataDir, 'geometry')).length} floor plans).`);
