# Data for Git-triggered deploys

`data/` (floor plans from the Matterport Model API, `listings.json`) is git-ignored: it comes from
the CoStar kit and is about 80 MB (19 MB packed). A Git-triggered Vercel build only sees what is in
git, so the build downloads it first (`npm run build` runs `prebuild` → `scripts/fetch-data.mjs`).

## How it is set up now

- A **private** Vercel Blob store, `furniche-data`, is connected to the `furniche` project for
  Production and Preview. Connecting it added `BLOB_READ_WRITE_TOKEN` to those environments.
- The archive is `data/furniche-data.tar.gz` in that store. Private means a request without the
  token returns 403.
- On Vercel, `fetch-data.mjs` reads it with the `@vercel/blob` SDK (`get(path, { access: 'private' })`),
  checks `DATA_ARCHIVE_SHA256` if set, and unpacks it into `data/`.
- Verified on a Preview deploy: the build restored all 3,136 floor plans and `/api/models/<sid>` served one.

## Updating the data

```bash
bash scripts/pack-data.sh                       # → furniche-data.tar.gz and its sha256
vercel blob put furniche-data.tar.gz --access private \
  --pathname data/furniche-data.tar.gz --allow-overwrite true
```

If you set `DATA_ARCHIVE_SHA256` in the project, update it to the new checksum, or the build fails.

## Turning on deploys from `main`

Delete the `"git": { "deploymentEnabled": false }` block in `vercel.json`. Production Branch Tracking
is already `main`, and `binaryshrey/Furniche` is already connected.

## Other sources and behaviour

- No Blob store? Set `DATA_ARCHIVE_URL` (and optionally `DATA_ARCHIVE_TOKEN`, sent as a Bearer token)
  to any private URL instead. `DATA_BLOB_PATH` changes the file name inside the store.
- `data/` already present (local dev, CLI deploys): the script does nothing.
- Missing on Vercel and nothing configured: the build fails with a clear message, so a broken site
  is never promoted. Missing locally: it warns and continues.
- Local runs: the Blob read needs the token Vercel injects during builds, which `vercel env pull`
  hides (it is sensitive), so test with a Preview deploy rather than locally.
- `next.config.mjs` already bundles `data/geometry` with the routes that read it.
- Do not run `vercel blob create-store` or `vercel env pull` without a path argument if you care
  about your local `.env.local`: both rewrite it (they replaced it once while this was set up).
