// Downloads the git-ignored data/ folder (floor plans, listings) before the build, so Git-triggered
// Vercel deploys work. It does nothing when data/ is already there (local dev, CLI deploys).
//
// Env:
//   DATA_ARCHIVE_URL      where furniche-data.tar.gz lives (required on Vercel)
//   DATA_ARCHIVE_TOKEN    optional, sent as "Authorization: Bearer <token>"
//   DATA_ARCHIVE_SHA256   optional, the archive's sha256; the build fails if it differs
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
if (!url) {
  if (onVercel) fail('data/ is missing and DATA_ARCHIVE_URL is not set. Add it in the Vercel project environment variables.');
  console.warn('fetch-data: data/ is missing and DATA_ARCHIVE_URL is not set; skipping (set it, or add data/ by hand).');
  process.exit(0);
}

const headers = process.env.DATA_ARCHIVE_TOKEN ? { Authorization: `Bearer ${process.env.DATA_ARCHIVE_TOKEN}` } : {};
console.log('fetch-data: downloading the data archive…');
const res = await fetch(url, { headers, redirect: 'follow' });
if (!res.ok) fail(`download failed: HTTP ${res.status} ${res.statusText}`);
const buf = Buffer.from(await res.arrayBuffer());

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
