# Data for Git-triggered deploys

`data/` (floor plans from the Matterport Model API, `listings.json`) is git-ignored: it comes from
the CoStar kit and is about 80 MB. A Git-triggered Vercel build only sees what is in git, so the
build downloads it first (`npm run build` runs `prebuild` → `scripts/fetch-data.mjs`).

## One-time setup

1. Pack it: `bash scripts/pack-data.sh` → `furniche-data.tar.gz` and its sha256.
2. Upload the archive somewhere **private** (Vercel Blob, Cloudflare R2, S3, a private GitHub
   release asset). Do not publish it: the data comes from the hackathon organisers.
3. In the Vercel project, Settings → Environment Variables (Production and Preview):
   - `DATA_ARCHIVE_URL`: the archive URL (a signed or token-protected URL)
   - `DATA_ARCHIVE_TOKEN`: optional, sent as a Bearer token
   - `DATA_ARCHIVE_SHA256`: optional, the checksum from step 1 (the build fails if it differs)
4. Deploy a branch first (a Preview deploy) and open a home to check floor plans load.
5. Only then turn on pushes-to-`main` deploys by deleting the `git.deploymentEnabled: false` block
   in `vercel.json`.

## Behaviour

- `data/` already present (local dev, CLI deploys): the script does nothing.
- Missing on Vercel and `DATA_ARCHIVE_URL` unset: the build fails with a clear message, so a
  broken site is never promoted.
- Missing locally and `DATA_ARCHIVE_URL` unset: it warns and continues.
- `next.config.mjs` already bundles `data/geometry` with the routes that read it.
