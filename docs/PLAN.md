> Original build plan, written for Los Angeles. The app has since moved to Houston (Vexcel's 3D
> city mesh is Houston-only) and gained plain-language search, a map and a 3D city view; see README.

# FurNiche AI : implementation plan

Status: draft for approval · Written 2026-11-14 · Deadline: Devpost submission Sun 2026-11-15 08:00 ET
Repo: https://github.com/binaryshrey/Furniche (public, empty)

## 1. What we are building

FurNiche AI lets someone open a real Los Angeles listing, walk its Matterport scan with the furniture
removed, and furnish it by dragging in real products from IKEA, Amazon and other stores. Every
item is true to size, checked against the room's measurements, and lands in a cart with buy links.

- **Users:** home buyers and renters on Homes.com and Apartments.com; secondarily agents staging a listing.
- **Why it matters to CoStar:** buyers of existing homes spend about $18,700 in their first year on
  furnishings, appliances and remodeling (NAHB, Aug 2026). Zillow has AI staging but no way to buy
  what it shows. CoStar already has the measured scan before anyone moves in.
- **Track fit:** "Furnish an empty room" is one of Matterport's listed open problems. The outdoor
  planner uses Vexcel, which keeps the "Inside and Out" theme. Listing facts come from the CoStar kit.
- **Inspiration (do not copy branding, text or images):** The Good Room Planner (paste a product
  link, item lands at real size, see if it fits), Roomephant (paste a link from any store),
  MattoBoard (editorial look, material mood boards, "generate a concept" prompt).

## 2. Verified facts and open unknowns

Verified on 2026-11-14 with the team's keys:

| Fact                                     | Detail                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matterport Model API key works           | `POST https://api.matterport.com/api/models/graph`, HTTP basic auth (key = user, token = password)                                                                                                                     |
| Sample LA home                           | `zvKHR9DHNjJ`, 5836 La Mirada Ave, public, 39 panoramas, 19 rooms, 1 floor                                                                                                                                             |
| Defurnished view exists and is queryable | `views { id type }` returns one of type `matterport.model.defurnished`; querying `model(id: <that view id>)` returns the same 39 panos with 6 skybox faces each at `2k`                                                |
| Room sizes                               | `rooms { dimensions(units: metric) { areaFloor width depth height } }` returns metres. `dimensionEstimates` returns feet and adds `lowerElevation`                                                                     |
| Walls                                    | `floors { vertices { id position { x y } } edges { id type thickness vertices { id } } }`; metres, same frame as panos. On the sample every edge has `type: "wall"`, so **doors and windows are not marked**           |
| Room outline                             | `rooms { boundary { edges { id } } }` lists wall edge ids (unordered; chain them into a polygon)                                                                                                                       |
| Pano positions                           | `panoLocations { id label position { x y z } }`; metres, Z up; z is about 1.47 m above the floor                                                                                                                       |
| Vexcel key works in LA                   | `GET https://api.vexcelgroup.com/v2/property/extract?wkt=POINT(lon lat)&srid=4326`, header `X-API-KEY`. Returns the parcel polygon, structures, and attributes such as `hardscapes.area`, `deck.area`, `pool.detected` |
| LA coverage                              | 418 LA home listings have scans, 404 with a defurnished view. 2,032 LA apartment-unit scans (794 communities) have a defurnished view                                                                                  |
| npm packages                             | `@matterport/sdk` 1.6.2; `@matterport/r3f` 0.2.7 with peers `react ^18`, `@react-three/fiber ^8.9.2`, `@matterport/webcomponent`                                                                                       |

Not yet verified (resolve in the Milestone 0 spike):

1. The SDK key loads hackathon models on `localhost` through the web component.
2. The SDK can switch to the defurnished view. The SDK changelog mentions `View.setActive`,
   `View.current`, and automatic exposure of the Defurnish view (release 25.3.4); exact calls unconfirmed.
3. React Three Fiber children render inside `<MatterportViewer>` and can be positioned from
   `MatterportPointer` / `sdk.Pointer.intersection`.
4. How SDK coordinates (three.js, Y up) map to Model API coordinates (Z up). Expected:
   `sdk = (api.x, api.z, -api.y)`. Confirm by comparing one sweep position from both.
5. The size in pixels of a Vexcel ortho image for a given `bbox-dimensions`, and that it is north-up.

## 3. Scope and cut order

Team decisions (2026-11-14): curated catalog plus paste-a-link; MattoBoard-style look and theme
feature; fit check, AI stylist, paint/wallpaper/flooring and outdoor planner all wanted; the only
paid AI service is an LLM API.

| Tier | Feature                                                                          | Cut if late?                              |
| ---- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| P0   | Explore LA listings; open a scan in its empty-room view                          | No                                        |
| P0   | Shop panel with curated catalog; place, move, rotate, delete items at true size  | No                                        |
| P0   | Cart with totals and buy links; design saved in the browser                      | No                                        |
| P1   | Fit check (too big, overlaps, walkway too narrow, taller than ceiling)           | No                                        |
| P1   | Themes and mood boards; AI stylist ("furnish this room in Japandi under $3,000") | Stylist can fall back to preset room sets |
| P1   | Paste a product link (LLM reads the page; size-accurate stand-in model)          | Fall back to manual size entry            |
| P2   | Paint, wallpaper, flooring preview with quantities and cost                      | First to cut down to quantities only      |
| P2   | Outdoor planner on the Vexcel aerial image                                       | Second to cut                             |

Out of scope: real checkout or payments, user accounts, a database, mobile layout, photoreal
AI renders (no image API), AI-generated 3D models (no image-to-3D API).

## 4. Architecture

```
Browser (Next.js client)
  Explore page ──> Editor page ──────────────────────────────┐
                   ├─ Viewer: MatterportViewer (Path A)       │ shared R3F furniture layer
                   │          or PanoViewer (Path B)          │
                   ├─ PlanView (2D SVG, wall graph)           │
                   ├─ Shop panel / Design panel / Cart        │
                   └─ zustand store ── localStorage           │
Next.js route handlers (server; hold secrets)                 │
  /api/models/[sid]   -> Matterport Model API (GraphQL)       │
  /api/skybox         -> proxies signed pano face images      │
  /api/products/import-> fetch product page + LLM extraction  │
  /api/stylist        -> LLM picks products; solver places    │
  /api/vexcel/*       -> Vexcel property + ortho              │
Local files (git-ignored): data/la-listings.json built from the CoStar kit
```

**Stack**

- Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS. **Pin React 18**: `@matterport/r3f`
  requires React 18 and `@react-three/fiber` 8. Do not scaffold with Next 15/16.
- `three`, `@react-three/fiber@8`, `@react-three/drei@9`, `@matterport/webcomponent`, `@matterport/r3f`.
- `zustand` (state, with `persist`), `zod` (schemas), `lz-string` (share links).
- LLM through the Vercel AI SDK (`ai` + one provider package) so the provider follows whichever key
  the team has. Use structured output (`generateObject` with zod). If the key is Anthropic, load the
  Claude API reference before writing the calls and use a current Sonnet-class model.
- No database. No auth.

**Coordinate convention**

- All stored positions are in the **Matterport Model API frame: metres, Z up**. Plan view uses (x, y).
- Convert at the render boundary only: `toThree(p) = (p.x, p.z, -p.y)` (confirm in spike).
- Item rotation is a single angle about the vertical axis, in radians.

## 5. Viewer: two paths, one furniture layer

Write the furniture layer (`<FurnitureLayer>`, `<FurnitureItem>`, selection gizmo) as plain React
Three Fiber components. They render unchanged inside either host.

**Path A (preferred): Matterport viewer**

- `npx matterport-assets public/matterport-assets`, then
  `<MatterportViewer m={sid} assetBase="matterport-assets" applicationKey={NEXT_PUBLIC_MATTERPORT_SDK_KEY} onPlaying={sdk => ...}>`.
- Load client-side only (`'use client'` plus `dynamic(..., { ssr: false })`).
- On play: find the defurnished view through `sdk.View` and activate it. Offer an Empty / Furnished toggle.
- Pointer: `sdk.Pointer.intersection` gives position, normal and floor for placement.
- Benefits: real walkthrough, dollhouse view, depth-correct occlusion, sponsor technology on screen.

**Path B (fallback): our own panorama viewer**

- Plain R3F `<Canvas>`. Background is a cube texture built from the 6 defurnished skybox faces
  (order: up, four sides, down) fetched through `/api/skybox`. Camera sits at the pano position.
- Invisible floor plane at the room's floor height for raycasting. Wall graph extruded to room
  height as depth-only meshes so walls hide furniture behind them.
- Navigation: clickable markers at other pano positions; switching swaps the cube texture and camera.
- Uses only calls already verified. Works when deployed (no SDK domain limit).

**Decision gate (90 minutes into the build):** stay on Path A only if all three work on
`localhost`: the model loads with the SDK key, the defurnished view shows, and a test box can be
placed on the floor under the pointer. Otherwise switch the editor to Path B and keep a plain
Matterport iframe (`https://my.matterport.com/show/?m=<sid>&play=1&qs=1`) as a "Tour" tab.

**PlanView (both paths):** a 2D SVG top view of the active floor from the wall graph, with room
labels, furniture footprints and fit warnings. It is a second way to place and move items and is
reused by the outdoor planner.

## 6. Data

### 6.1 LA listings (from the CoStar kit, build-time script)

`scripts/build_listings.py` reads `costar-hackathon-kit/` and `matterport_kit/models_index.csv`
and writes `data/la-listings.json` (git-ignored).

- Homes: join `residential-listings.csv` (`ListingId`, `MatterportModelId`) to
  `data/residential-listings.jsonl` on `id`; keep LA (`lon < -110`) and `defurnished == yes`.
  Fields: address, price (`currentPrice`), beds, baths, sqft, year built, status, lat/lon, model sid.
- Apartments: join `commercial-properties.csv` to the model index; keep LA unit scans (name matches
  bedroom or studio patterns) with a defurnished view; add community name and asking-rent range
  from `data/apartment-listing.jsonl` on `propertyId`.
- **Do not commit this file or the kit.** The repo is public and the kit is licensed for the
  hackathon only. Commit the script and a README step instead.

### 6.2 Room geometry (runtime, per model)

`/api/models/[sid]` returns a trimmed object; cache in memory for the session.

```ts
type Vec2 = { x: number; y: number }; // metres, API frame
type Room = {
  id: string;
  label: string;
  floorId: string;
  polygon: Vec2[]; // ordered, from boundary edges
  areaM2: number;
  widthM: number;
  depthM: number;
  heightM: number | null;
  floorZ: number; // metres
};
type Pano = {
  id: string;
  label: string;
  pos: { x: number; y: number; z: number };
};
type ModelGeometry = {
  sid: string;
  defurnishedViewId: string | null;
  walls: { id: string; a: Vec2; b: Vec2; thickness: number }[];
  rooms: Room[];
  panos: Pano[];
};
```

Skip rooms labelled `Void`. Null fields are omitted by the API, so read defensively.
Signed image URLs expire: never store them; re-query.

### 6.3 Catalog

`catalog/products.json`, about 60 real products, entered from live retailer pages and checked by a person.

```ts
type Product = {
  id: string;
  source: "curated" | "imported";
  retailer: "ikea" | "amazon" | "wayfair" | "other";
  name: string;
  url: string;
  imageUrl: string;
  priceUsd: number;
  priceCheckedAt: string; // ISO date
  category: Category; // sofa, armchair, bed, desk, ...
  dimsCm: { w: number; d: number; h: number };
  color?: string;
  styles: ThemeId[];
  placement: "floor" | "wall" | "surface" | "ceiling" | "outdoor";
  modelKey: string; // archetype GLB in public/models
  standIn: boolean; // true when the 3D shape is generic
};
```

- **3D models:** about 30 archetype GLBs (3-seat sofa, sectional, armchair, coffee table, side
  table, TV console, bookshelf, rectangular and round dining table, dining chair, queen and king
  bed, nightstand, dresser, wardrobe, desk, office chair, floor lamp, rug, plant, mirror, wall art,
  pendant, bar stool, bench; outdoor: patio table, patio chair, lounger, umbrella, grill, planter).
  Source them from permissively licensed libraries (for example Kenney, Poly Haven, Quaternius);
  record each file's licence in `public/models/LICENSES.md`.
- Normalise each GLB once (`scripts/normalize_models.ts`): origin at bottom centre, front facing
  one fixed axis, bounding box recorded. At render time scale non-uniformly to `dimsCm`.
- Use the paste-a-link importer to build the curated list quickly, then correct by hand.
- Do not download or redistribute retailers' own 3D files.

### 6.4 Design state

```ts
type PlacedItem = {
  uid: string;
  productId: string;
  roomId: string | null;
  pos: { x: number; y: number; z: number };
  rot: number;
};
type SurfaceChoice = {
  roomId: string;
  target: "walls" | "floor" | { wallId: string };
  materialId: string;
};
type Design = {
  sid: string;
  items: PlacedItem[];
  surfaces: SurfaceChoice[];
  themeId: ThemeId | null;
  updatedAt: string;
};
```

Persist per `sid` in `localStorage`. Share link: the design JSON compressed with `lz-string` in the URL hash.

## 7. Feature specifications

**7.1 Explore (`/explore`)**
List and simple map of LA listings from `data/la-listings.json`. Tabs: Homes for sale, Apartments.
Card: photo or scan thumbnail (`model.image.url`), address, price or rent, beds, baths, sqft.
Click opens `/space/[sid]`.

**7.2 Editor (`/space/[sid]`)**

- Layout: shop panel left; viewer centre with 3D / Plan toggle, Empty / Furnished toggle and room
  picker; design panel right (items, warnings, running total). Top bar: listing facts, Share, Cart.
- Place: drag a product card over the viewer; a ghost follows the pointer on the floor; release to
  place. Use pointer events, not HTML5 drag-and-drop, so the viewer keeps receiving pointer moves.
  Keyboard path: select a card, press Enter, click the floor.
- Edit: click to select; drag to move along the floor; rotate with a ring handle or `R` (15° steps);
  `Delete` removes; `D` duplicates. Disable camera navigation while dragging an item.
- Wall and ceiling items snap to the hit surface using its normal.

**7.3 Shop panel**
Search, retailer chips, category chips, price range, "Fits this room" toggle, theme filter.
Card shows image, name, retailer, price and W × D × H. Stand-in models carry a "generic shape, true size" tag.

**7.4 Paste a link (`POST /api/products/import`)**

1. Fetch the page server-side. Collect JSON-LD, Open Graph tags and a trimmed text excerpt.
2. LLM returns `{ name, retailer, priceUsd, dimsCm, category, color, imageUrl, confidence }` (zod-validated).
3. Show an editable confirmation card; the user can correct sizes before adding.
4. Assign the category's archetype GLB, scale to `dimsCm`, tint to `color`, set `standIn: true`.
5. If the fetch is blocked (likely for Amazon), offer: paste the product text, or enter name and
   W × D × H by hand. Never invent dimensions: missing size means the user must enter it.

**7.5 Fit check (`lib/fit.ts`, pure functions, unit-tested)**
Inputs: room polygon and height, placed items as rotated rectangles. Rules (values in a config file):

- Outside the room polygon or crossing a wall: red.
- Overlapping another floor item (rugs excepted): red.
- Taller than the ceiling: red.
- Walkway narrower than 76 cm between items or item and wall: amber, with the measured gap.
- Category clearances: 45 cm sofa to coffee table, 60 cm beside a bed, 90 cm behind a desk or
  dining chair: amber.
- "Fits this room" filter: item footprint plus clearance fits within the room's width and depth.
  Doors are not in the data. Let the user mark a door on a wall in Plan view (default 81 cm wide);
  marked doors get a keep-clear zone. Say plainly in the UI that door positions are user-marked.

**7.6 Cart (`/cart`)**
Items grouped by retailer with quantity, price, "Buy at retailer" link, total, and price-checked date.
Copy-as-text button. No checkout.

**7.7 Themes and mood boards**
`catalog/themes.json`: six themes (for example Midcentury, Japandi, Scandinavian, Industrial,
Coastal, Modern Organic), each with a palette, wall and floor materials, and product tags.

- Mood board view: a collage of material swatches and product cut-outs with soft shadows.
- "Describe a concept" prompt box: free text → LLM maps it to a theme mix and a product shortlist.
- "Apply to this room" sets surfaces and runs the stylist with that theme.

**7.8 AI stylist (`POST /api/stylist`)**

- Input: room (label, polygon, size, marked doors), theme, budget, items already placed, and a
  compact catalog list (id, name, category, size, price, styles).
- The LLM chooses products and gives a one-line reason each. It does **not** output coordinates.
- A deterministic solver places them by rule (sofa centred on the longest free wall, coffee table
  45 cm in front, rug under both, TV console opposite; bed head on the longest wall without a door,
  nightstands either side; desk on a short wall), then runs the fit check and swaps or drops items
  that fail. Return the placed set, total cost and reasons.
- Fallback without an LLM: preset room sets per theme and room type.

**7.9 Paint, wallpaper, flooring (P2)**

- Materials catalog: paints (hex, price per gallon), wallpapers and floorings (tiling texture, price per unit).
- Preview: semi-transparent meshes over the chosen wall or the room's floor polygon, offset 1 cm.
  Because windows and doors are not in the data, apply per wall the user clicks, and label the
  preview as approximate.
- Quantities: wall area = wall length × room height, minus marked doors and a default allowance;
  two coats; coverage and roll sizes live in a config file with their source noted. Flooring adds
  10% waste. Show gallons, rolls or square feet and cost; add to cart.

**7.10 Outdoor planner (`/outside/[listingId]`, P2)**

- `/api/vexcel/property` returns the parcel polygon, building footprints and attributes.
  `/api/vexcel/ortho` proxies `GET /v2/ortho/extract?layer=urban&bbox-dimensions=W,H&zoom=21&wkt=POINT(lon lat)&srid=4326`.
- Show the aerial image as a to-scale canvas (metres per pixel from `bbox-dimensions` and image
  size) with parcel and buildings outlined. Reuse PlanView to drag outdoor items at true size.
- Fit check: inside the parcel, not on a building, not on a detected pool. Show hardscape and deck area.
- Homes only (apartment communities share grounds).

## 8. API routes

| Route                            | Method | Purpose                                  | Secrets used           |
| -------------------------------- | ------ | ---------------------------------------- | ---------------------- |
| `/api/models/[sid]`              | GET    | Rooms, walls, panos, defurnished view id | Matterport key + token |
| `/api/skybox?sid&pano&face&view` | GET    | Stream one pano face image (Path B)      | Matterport key + token |
| `/api/products/import`           | POST   | Read a product link into a `Product`     | LLM key                |
| `/api/stylist`                   | POST   | Choose and place products for a room     | LLM key                |
| `/api/vexcel/property?lat&lon`   | GET    | Parcel, footprints, attributes           | Vexcel key             |
| `/api/vexcel/ortho?lat&lon&w&h`  | GET    | Aerial image                             | Vexcel key             |

Keep Matterport calls well under 10 per second; the keys are shared rate limits.

## 9. Repository layout

```
app/  (page.tsx, explore/, space/[sid]/, cart/, outside/[listingId]/, api/...)
components/  viewer/ (MatterportHost, PanoHost, FurnitureLayer, FurnitureItem, Gizmo)
             plan/ (PlanView)  shop/  design/  board/  ui/
lib/  matterport.ts  vexcel.ts  geometry.ts  fit.ts  solver.ts  coords.ts  store.ts  llm.ts
catalog/  products.json  themes.json  materials.json  fit-rules.json
public/  models/*.glb  models/LICENSES.md  textures/  matterport-assets/ (generated)
scripts/  build_listings.py  normalize_models.ts
data/  (git-ignored)
.env.local (git-ignored)  .env.example  README.md
```

`.gitignore` must include `.env*` (except `.env.example`), `data/`, `costar-hackathon-kit/`,
`matterport_kit/`, `public/matterport-assets/`.

Environment variables: `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`,
`NEXT_PUBLIC_MATTERPORT_SDK_KEY`, `VEXCEL_API_KEY`, and the LLM provider key.
The team's values are in `~/Documents/hackprinceton/.env`; copy them to `.env.local`.

## 10. Visual design

MattoBoard-inspired, not a copy: white or warm off-white ground, a characterful serif for
headlines, a quiet sans for UI, one dark ink colour for primary buttons, generous spacing,
material swatches and product cut-outs with soft realistic shadows, a pill-shaped prompt box for
"Describe a concept". Use our own name, logo, copy and images. Keep the editor chrome quiet so the
room is the focus. Follow the workshop's advice: the AI drives the screen (stylist, concept prompt)
rather than sitting in a chat window.

## 11. Milestones

Assumes about 24 hours remain and up to four people. Hours are elapsed from start.

| #   | Hours | Deliverable                                                                                                          | Done when                                                                                               |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| M0  | 0–1.5 | Scaffold, env, `.gitignore`; Path A spike                                                                            | Decision gate in section 5 answered; coordinates confirmed                                              |
| M1  | 1.5–5 | Listings script and Explore; `/api/models/[sid]`; furniture layer; place, move, rotate, delete; 15 products, 10 GLBs | A sofa can be placed at true size in the sample home and survives a reload                              |
| M2  | 5–9   | Full shop panel, 60 products, cart; PlanView; fit check with tests                                                   | Oversized item shows red; narrow walkway shows amber with the gap; cart total is correct                |
| M3  | 9–13  | Themes and mood boards; stylist and solver; paste a link                                                             | "Japandi under $3,000" fills a living room with no red warnings; an IKEA link imports with correct size |
| M4  | 13–16 | Paint and flooring preview with quantities; outdoor planner                                                          | One wall recolours with gallons and cost; a patio set is placed to scale on the aerial image            |
| M5  | 16–20 | Polish, empty states, README, demo script, backup video, Devpost                                                     | Three full run-throughs without errors; video recorded                                                  |

Suggested split: (A) viewer and 3D interaction; (B) data, API routes, geometry, fit, solver;
(C) shop, catalog entry, cart, importer; (D) design system, themes, stylist prompts, pitch.
Freeze features about 5 hours before the deadline.

## 12. Risks and fallbacks

| Risk                                                   | Fallback                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| SDK key or defurnished view fails in the web component | Path B viewer                                                               |
| `@matterport/r3f` breaks under Next.js                 | Path B; or the SDK Scene API in a plain client component                    |
| Retailer pages block fetching                          | Paste text or manual entry                                                  |
| LLM returns wrong sizes                                | Confirmation card; sizes always editable; never auto-accept low confidence  |
| Wall overlays look wrong (no door or window data)      | Per-wall click-to-paint; ship quantities and cost without the preview       |
| Vexcel ortho scale or orientation unclear              | Ship parcel and footprint outlines only; or cut the outdoor planner         |
| Stand-in shapes look generic                           | Label them; prioritise accurate size and good archetypes for the demo rooms |
| Demo depends on the network                            | Pre-open the demo home; keep a recorded backup video                        |

## 13. Rules and compliance

- Never commit keys. The SDK key is public by design but only works on `localhost`, so **demo from
  localhost** unless the booth adds a deploy domain.
- Never commit CoStar kit data or files derived from it without the booth's permission.
- At least 85% of the code must be written during the event; the repo must be public.
- Record licences for every 3D model and texture. Link out to retailers; no scraping at volume.
- All prices show the date they were checked. All fit warnings state when a door is user-marked.

## 14. Demo script (3 minutes)

1. Explore: LA homes for sale; open 5836 La Mirada Ave.
2. Toggle Furnished → Empty. Walk to the living room.
3. Drag a real IKEA sofa in. It is too deep for the wall: red warning with the measured shortfall.
   Swap to one that fits: green.
4. Type "warm Japandi under $3,000". The room fills; the total updates; no warnings.
5. Paste a store link. The item appears at its real size.
6. Paint one wall; see gallons and cost.
7. Outside: the aerial view of the same home; place a patio set on the hardscape.
8. Cart: grouped by store, total, buy links.
   Close: "Every listing CoStar scans becomes a store that only sells what fits."

## 15. Questions for the CoStar booth

1. Does the SDK key work for every model in the hackathon organisation, and can the SDK switch to the defurnished view?
2. May we commit a small listing subset derived from the kit to a public repo, or must all of it stay local?
3. Can a deploy domain be added to the SDK key?
4. Are door and window positions available anywhere? Every wall edge we see has type `wall`.

## 16. Notes for the implementing agent

- Read `~/Documents/hackprinceton/matterport_kit/AGENTS.md` and `matterport_quickstart.py` first;
  they hold working examples of every Matterport call above.
- Start with Milestone 0 and report the decision-gate result before building further.
- Keep geometry, fit and solver code pure and unit-tested; they carry the demo's credibility.
- Keep all positions in the API frame; convert only in `lib/coords.ts`.
- Commit small and often on a feature branch; do not push secrets or data.
