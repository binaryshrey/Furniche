// Builds the Matterport model index that scripts/build_listings.py reads (sid, name, address, lat,
// lon, defurnished, room_count, splat) for every model in the CoStar kit, from the Matterport Model
// API. Use it when you don't have the organisers' matterport_kit/models_index.csv:
//
//   node scripts/build_model_index.mjs --kit ~/Downloads/costar-hackathon-kit
//   python3 scripts/build_listings.py --kit ~/Downloads/costar-hackathon-kit --index data/models_index.csv
//
// Reads MATTERPORT_API_KEY and MATTERPORT_API_TOKEN from .env.local. Only models in --state (TX,
// for Houston, by default) are looked up. `splat` is always "no": the API doesn't say, and the app
// doesn't use it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const kit = arg('kit', '../costar-hackathon-kit').replace(/^~(?=$|\/)/, os.homedir());
const out = arg('out', 'data/models_index.csv');
const state = arg('state', 'TX').toUpperCase();
const BATCH = 25;
const PARALLEL = 3; // the API keys are shared: stay well under 10 requests a second

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
if (!env.MATTERPORT_API_KEY || !env.MATTERPORT_API_TOKEN) throw new Error('Set MATTERPORT_API_KEY and MATTERPORT_API_TOKEN in .env.local');
const auth = 'Basic ' + Buffer.from(`${env.MATTERPORT_API_KEY}:${env.MATTERPORT_API_TOKEN}`).toString('base64');

// Rows of a CSV file with a header, as objects (quoted fields may hold commas and quotes).
function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') row.push(field), (field = '');
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field), rows.push(row), (row = []), (field = '');
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const sids = [
  ...new Set(
    ['residential-listings.csv', 'commercial-properties.csv']
      .flatMap((f) => readCsv(path.join(kit, f)))
      .filter((r) => r.MatterportModelId && r.State.trim().toUpperCase() === state)
      .map((r) => r.MatterportModelId.trim()),
  ),
];
console.log(`${sids.length} models in ${state}; asking the Model API ${BATCH} at a time…`);

async function lookUp(batch, attempt = 1) {
  const query = `query {${batch.map((s, i) => `m${i}: model(id: ${JSON.stringify(s)}) { id name address { address } geolocation { lat long } views { type } rooms { id } }`).join(' ')}}`;
  const res = await fetch('https://api.matterport.com/api/models/graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  }).catch((e) => ({ ok: false, status: e.name }));
  if (!res.ok) {
    if (attempt >= 4) throw new Error(`Matterport API ${res.status} after ${attempt} tries`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return lookUp(batch, attempt + 1);
  }
  const { data } = await res.json(); // a model this key can't see comes back null
  return Object.values(data ?? {}).filter(Boolean);
}

const csvField = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const lines = ['sid,name,address,lat,lon,defurnished,room_count,splat'];
const batches = Array.from({ length: Math.ceil(sids.length / BATCH) }, (_, i) => sids.slice(i * BATCH, (i + 1) * BATCH));
let done = 0;
let found = 0;
for (let i = 0; i < batches.length; i += PARALLEL) {
  for (const models of await Promise.all(batches.slice(i, i + PARALLEL).map((b) => lookUp(b)))) {
    for (const m of models) {
      found++;
      const defurnished = (m.views ?? []).some((v) => v.type === 'matterport.model.defurnished');
      lines.push([m.id, m.name ?? '', m.address?.address ?? '', m.geolocation?.lat ?? '', m.geolocation?.long ?? '', defurnished ? 'yes' : 'no', (m.rooms ?? []).length, 'no'].map(csvField).join(','));
    }
  }
  done = Math.min(sids.length, (i + PARALLEL) * BATCH);
  if ((i / PARALLEL) % 10 === 0 || done === sids.length) console.log(`  ${done} / ${sids.length}`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${out}: ${found} models (${sids.length - found} not visible to this key)`);
