# Furniche AI

Furnish a real Houston listing before you move in. Open the home's Matterport scan in its
empty-room view, shop furniture from IKEA, Amazon, West Elm, Wayfair and Target, and drop each
piece into the room at its true size. Furniche checks the fit, styles a room for you, prices
paint and flooring, and plans the yard on a Vexcel aerial image.

Built at HackPrinceton Fall 2026 for CoStar's "Inside and Out: AI for the Built World" track.

## What it does

- **Search in plain words.** Type "3 bed apartments under $2,000" or "studio in Montrose under
  $1,500". Matches appear as price tags on a Vexcel aerial map with a carousel of every result;
  click one to walk into its scan. Neighbourhood names become a radius search.
- **Float over the 3D city.** Vexcel's 3D mesh of Houston streams into the browser with every
  match floating above its building. Drag, tilt and zoom, or fly with W A S D and Q/E; hover a
  card to glide to that home and click a pin to walk inside.
- **Furnish the real room.** The scan opens in Matterport's defurnished view. Drag a product
  from the shop onto the floor; it lands at its catalogue size. Drag to move, `R` rotate,
  `D` duplicate, `Delete` remove.
- **Fit check.** Every piece is checked against the room outline from the Matterport Model API:
  crossing a wall, overlapping, taller than the ceiling, blocking a door you marked, and
  walkways under 76 cm. Seat–table pairs (sofa and coffee table, bed and nightstand) get their
  own spacing rule.
- **Floor plan.** A to-scale plan from the scan's wall graph, with the same drag and fit check.
- **AI stylist.** Describe a look and budget ("warm japandi under $3,000"). Claude only picks
  products; a deterministic solver places them against the room's walls and drops optional
  pieces that would break the fit check. Without an API key a rule-based picker is used.
- **Paste a link.** Paste a product page; Furniche reads its structured data for name, price and
  size (including fractional inches). It never guesses a size: if none is on the page, you
  enter it.
- **Walls and floor.** Paint, wallpaper and flooring per room, with gallons (2 coats,
  350 sq ft per gallon, 15% for openings) and flooring area (+10% waste).
- **Mood boards.** Six themes with palettes, finishes and matching products.
- **Plan the yard.** For homes, the Vexcel aerial image is shown to scale with the parcel line
  and building footprints. Place patio furniture and see lot, paved, deck, pool and tree-cover
  figures. Pieces off the lot or on a building turn red.
- **Ask Furniche (chat).** A chat in the editor that knows the open home and design. Ask about
  any piece, price, look or light, or tell it what to change: add, remove or swap furniture,
  "make this room feel bigger" (re-lays the room for the most open floor, or swaps in smaller
  pieces of the same style), paint and flooring, and warmer or brighter light in the 3D view.
  Runs on Claude with tools; without `ANTHROPIC_API_KEY` common commands still work by keyword.
- **Move-in budget (Capital One Nessie).** Reads the mover's checking, savings and card, bills and
  paychecks from the Nessie sandbox and shows what is safe to spend without missing rent (bills
  and a $500 cushion kept back, 40% of savings, card kept under 30% use). The chat answers
  "what can I afford?", and the cart shows a pay-now / pay-later plan and pays each store as a
  Nessie purchase. Without `NESSIE_API_KEY` the same numbers come from demo data.
- **Text it on iMessage (Photon).** With `PHOTON_PROJECT_ID` and `PHOTON_API_KEY` set, the same
  assistant answers iMessages to your Photon line while the editor is open, and edits sent by
  text update the 3D room live. Messages are polled, so no public webhook URL is needed.
- **Cart and sharing.** One shopping list grouped by store with buy links, and a share link
  that carries the whole design in the URL.

## Run it

```bash
npm install --legacy-peer-deps
cp .env.example .env.local          # fill in the keys
npx matterport-assets public/matterport-assets   # Matterport viewer files (not in git)
python3 scripts/build_listings.py   # builds data/listings.json (Houston; --region la for LA)
npm run dev                          # http://localhost:3000
npm test
```

Open the app at `http://localhost:3000` (not `127.0.0.1`): the Matterport SDK key is limited to
localhost.

The CoStar kit and the generated `data/listings.json` are not in this repo; they come from
the hackathon organisers.

## How it works

- Next.js 14 (App Router), React 18, TypeScript, Tailwind, zustand.
- `@matterport/webcomponent` + `@matterport/r3f` host the scan; furniture is rendered with
  three.js inside Matterport's scene. Stand-in shapes are built at each product's exact size.
- `lib/matterport.ts` reads rooms, walls and panos from the Matterport Model API (GraphQL).
- `lib/vexcel.ts` reads the parcel and buildings from Vexcel's property API and frames the
  ortho image on the same centre, so the overlay lines up. Ortho map tiles and the 3D Tiles
  city mesh go through server routes so the API key never reaches the browser.
- `/sky` renders the 3D city with `3d-tiles-renderer` on three.js. The Draco and KTX2 decoders
  in `public/decoders/` are copied from three.js. Vexcel's 3D collection covers Houston only.
- `lib/search.ts` turns plain-language queries into filters (rules, plus Claude when a key is
  set); the search map uses Leaflet with Vexcel tiles.
- `lib/fit.ts` (separating-axis tests on footprints) and `lib/solver.ts` are pure functions
  with unit tests.
- Designs are saved in the browser; there are no accounts and nothing is sold.

The product catalogue is a curated sample; prices and sizes were checked on the date shown in
the cart and may have changed.
