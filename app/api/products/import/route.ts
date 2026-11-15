import { NextResponse } from "next/server";
import { z } from "zod";
import { llmAvailable, structured } from "@/lib/llm";
import type { Category, Retailer } from "@/lib/types";

const CATEGORIES: Category[] = [
  "sofa",
  "sectional",
  "armchair",
  "coffee-table",
  "side-table",
  "tv-console",
  "bookshelf",
  "dining-table",
  "round-table",
  "dining-chair",
  "bed",
  "nightstand",
  "dresser",
  "wardrobe",
  "desk",
  "office-chair",
  "floor-lamp",
  "rug",
  "plant",
  "mirror",
  "wall-art",
  "bench",
  "bar-stool",
  "patio-table",
  "patio-chair",
  "lounger",
  "umbrella",
  "planter",
];

const KEYWORDS: [RegExp, Category][] = [
  [/sectional|corner sofa|chaise/i, "sectional"],
  [/sofa|couch|loveseat|settee/i, "sofa"],
  [/armchair|accent chair|lounge chair|wing chair/i, "armchair"],
  [/coffee table/i, "coffee-table"],
  [/side table|end table/i, "side-table"],
  [/tv (stand|unit|bench|console)|media console/i, "tv-console"],
  [/bookcase|bookshelf|shelf unit|shelving/i, "bookshelf"],
  [/round (dining )?table/i, "round-table"],
  [/dining table|kitchen table/i, "dining-table"],
  [/office chair|desk chair/i, "office-chair"],
  [/bar stool|counter stool/i, "bar-stool"],
  [/dining chair|\bchair\b/i, "dining-chair"],
  [/bed frame|\bbed\b/i, "bed"],
  [/nightstand|bedside table/i, "nightstand"],
  [/dresser|chest of drawers/i, "dresser"],
  [/wardrobe|armoire/i, "wardrobe"],
  [/desk/i, "desk"],
  [/floor lamp/i, "floor-lamp"],
  [/\brug\b|carpet/i, "rug"],
  [/mirror/i, "mirror"],
  [/wall art|canvas|print|poster/i, "wall-art"],
  [/bench/i, "bench"],
  [/plant|planter|pot\b/i, "plant"],
];

function retailerOf(host: string): Retailer {
  if (/ikea\./.test(host)) return "ikea";
  if (/amazon\./.test(host)) return "amazon";
  if (/wayfair\./.test(host)) return "wayfair";
  if (/westelm\./.test(host)) return "west-elm";
  if (/target\./.test(host)) return "target";
  return "other";
}

function blockedHost(host: string): boolean {
  return (
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    !host.includes(".")
  );
}

const toCm = (v: number, unit: string) =>
  /in|"|”/.test(unit) ? Math.round(v * 2.54) : Math.round(v);

// Finds "W x D x H" style sizes, or labelled Width / Depth / Height values.
// Numbers like 30, 30.5, 30 1/8 or 6 ½ (US stores write inches with fractions).
const NUM = String.raw`\d+(?:\.\d+)?(?:\s+\d+\/\d+|\s*[½¼¾⅛⅜⅝⅞])?`;
const UNIT = String.raw`(?:cm|in\.?|inches|"|”)`;
const VULGAR: Record<string, number> = {
  "½": 0.5,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
  "⅜": 0.375,
  "⅝": 0.625,
  "⅞": 0.875,
};

function num(v: string): number {
  const [whole, rest = ""] = v.trim().split(/\s+|(?=[½¼¾⅛⅜⅝⅞])/);
  const frac = rest.includes("/")
    ? Number(rest.split("/")[0]) / Number(rest.split("/")[1])
    : (VULGAR[rest] ?? 0);
  return parseFloat(whole) + frac;
}

// Amazon-style sizes label each number: 30"D x 84"W x 34"H, or 84"L x 30"W x 34"H.
function labelledDims(
  text: string,
): { w: number; d: number; h: number } | null {
  const part = String.raw`(${NUM})\s*(${UNIT})?\s*([LWDH])\b`;
  const m = text.match(
    new RegExp(String.raw`${part}\s*[x×]\s*${part}\s*[x×]\s*${part}`, "i"),
  );
  if (!m) return null;
  const after = text.slice(
    (m.index ?? 0) + m[0].length,
    (m.index ?? 0) + m[0].length + 12,
  );
  const unit = m[2] ?? m[5] ?? m[8] ?? (/cm|centim/i.test(after) ? "cm" : "in");
  const vals: Record<string, number> = {};
  for (const i of [1, 4, 7])
    vals[m[i + 2].toUpperCase()] = toCm(num(m[i]), unit);
  // With both L and W, L runs along the front and W is front to back.
  const w = vals.L ?? vals.W;
  const d = vals.L != null ? (vals.W ?? vals.D) : vals.D;
  const h = vals.H;
  return w && d && h ? { w, d, h } : null;
}

function parseDims(text: string): { w: number; d: number; h: number } | null {
  const labelled = labelledDims(text);
  if (labelled) return labelled;
  const triple = text.match(
    new RegExp(
      `(${NUM})\\s*${UNIT}?\\s*[x×]\\s*(${NUM})\\s*${UNIT}?\\s*[x×]\\s*(${NUM})\\s*(${UNIT})`,
      "i",
    ),
  );
  if (triple) {
    const unit = triple[4];
    const [a, b, c] = [triple[1], triple[2], triple[3]].map((v) =>
      toCm(num(v), unit),
    );
    return { w: a, d: b, h: c };
  }
  const pick = (label: string) => {
    const m = text.match(
      new RegExp(`${label}[^0-9]{0,20}(${NUM})\\s*(${UNIT})`, "i"),
    );
    return m ? toCm(num(m[1]), m[2]) : null;
  };
  const w = pick("width") ?? pick("length");
  const d = pick("depth");
  const h = pick("height");
  return w && d && h ? { w, d, h } : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, prop: string): string | null {
  const m =
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
        "i",
      ),
    ) ??
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
        "i",
      ),
    );
  return m ? m[1] : null;
}

function jsonLdProduct(html: string): any | null {
  for (const m of html.matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1].trim());
      const items = Array.isArray(data) ? data : (data["@graph"] ?? [data]);
      const p = items.find(
        (x: any) =>
          x &&
          (x["@type"] === "Product" ||
            (Array.isArray(x["@type"]) && x["@type"].includes("Product"))),
      );
      if (p) return p;
    } catch {
      /* ignore malformed blocks */
    }
  }
  return null;
}

const Extracted = z.object({
  name: z.string(),
  priceUsd: z.number().nullable(),
  category: z.enum(CATEGORIES as [Category, ...Category[]]),
  widthCm: z.number().nullable(),
  depthCm: z.number().nullable(),
  heightCm: z.number().nullable(),
  color: z.string().describe("Main colour as a hex code like #c9b79c"),
  confidence: z.enum(["high", "medium", "low"]),
});

export async function POST(req: Request) {
  // `name`, `price` and `ld` (JSON-LD blocks) come from the "Add to Furniche" bookmarklet, which
  // reads the page in the shopper's own browser, so stores that block servers still work.
  const body = (await req.json().catch(() => ({}))) as {
    url?: string;
    text?: string;
    name?: string;
    price?: string;
    ld?: string[];
  };
  let url: URL | null = null;
  const fromBrowser = !!(body.name || body.ld?.length);
  let html = (body.ld ?? [])
    .slice(0, 20)
    .map(
      (b) =>
        `<script type="application/ld+json">${String(b).slice(0, 200_000)}</script>`,
    )
    .join("");
  const text = body.text?.slice(0, 20000) ?? "";
  if (!body.url?.trim() && !text.trim() && !fromBrowser) {
    return NextResponse.json(
      { error: "Paste a product link or its details text." },
      { status: 400 },
    );
  }

  if (body.url) {
    try {
      url = new URL(body.url);
    } catch {
      return NextResponse.json(
        { error: "That link is not a valid web address." },
        { status: 400 },
      );
    }
    if (!/^https?:$/.test(url.protocol) || blockedHost(url.hostname)) {
      return NextResponse.json(
        { error: "Only public http(s) product pages can be imported." },
        { status: 400 },
      );
    }
  }
  if (url && !fromBrowser) {
    try {
      // Follow redirects by hand so every hop passes the same public-host check.
      let next: URL = url;
      for (let hop = 0; hop < 4; hop++) {
        const res = await fetch(next, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Furniche product import; hackathon demo)",
            Accept: "text/html",
          },
          signal: AbortSignal.timeout(9000),
          redirect: "manual",
        });
        const loc =
          res.status >= 300 && res.status < 400
            ? res.headers.get("location")
            : null;
        if (loc) {
          next = new URL(loc, next);
          if (!/^https?:$/.test(next.protocol) || blockedHost(next.hostname))
            break;
          continue;
        }
        if (res.ok) html = (await res.text()).slice(0, 2_000_000);
        break;
      }
      if (html && next.pathname !== url.pathname && !jsonLdProduct(html)) {
        return NextResponse.json(
          {
            error:
              "That link redirected to a page that isn't a product. Check the link, or paste the product details text instead.",
          },
          { status: 422 },
        );
      }
    } catch {
      /* fall through to the paste-text path */
    }
    if (!html && !text) {
      // Most big stores (Amazon, Wayfair, Target, West Elm…) block server requests outright.
      const slug = url.pathname.match(
        /\/([A-Za-z0-9][A-Za-z0-9-]{8,})\/(?:dp|p|pdp)\b/,
      )?.[1];
      return NextResponse.json(
        {
          error: `${retailerOf(url.hostname) === "other" ? "This store" : url.hostname.replace(/^www\./, "")} blocks automatic reading. Use the Add to Furniche AI button on the product page, or paste the page text below.`,
          blocked: true,
          nameHint: slug ? slug.replace(/-/g, " ") : null,
        },
        { status: 422 },
      );
    }
  }

  const ld = html ? jsonLdProduct(html) : null;
  const pageText = (html ? stripHtml(html) : "") + " " + text;
  const name: string =
    ld?.name ??
    body.name?.slice(0, 200) ??
    (html && meta(html, "og:title")) ??
    text.split("\n")[0]?.slice(0, 120) ??
    "Imported item";
  const offer = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
  const price =
    offer?.price ??
    offer?.lowPrice ??
    (html ? meta(html, "product:price:amount") : null) ??
    body.price;
  const image =
    (Array.isArray(ld?.image) ? ld.image[0] : ld?.image) ??
    (html && meta(html, "og:image")) ??
    undefined;

  let draft = {
    name: String(name)
      .replace(/\s*[|–-]\s*(IKEA|Amazon\.com|Wayfair|West Elm|Target).*$/i, "")
      .trim(),
    priceUsd: price
      ? Number(String(price).replace(/[^0-9.]/g, "")) || null
      : null,
    category: (KEYWORDS.find(([re]) => re.test(name))?.[1] ??
      "side-table") as Category,
    dimsCm: parseDims(pageText),
    color: "#c9b79c",
    confidence: "low" as "high" | "medium" | "low",
    method: fromBrowser ? "the product page in your browser" : "page data",
  };
  if (draft.dimsCm && draft.priceUsd) draft.confidence = "medium";

  if (llmAvailable()) {
    const ai = await structured({
      system:
        "You extract furniture product facts from a store page. Use only facts stated in the text. " +
        "Return null for any size you cannot find; never estimate dimensions. Width is the longest side seen from the front, " +
        "depth is front to back, height is floor to top. Convert inches to centimetres.",
      user: `Page: ${url?.href ?? "(pasted text)"}\nStructured data name: ${draft.name}\nStructured data price: ${draft.priceUsd ?? "unknown"}\n\nPage text:\n${pageText.slice(0, 12000)}`,
      schema: Extracted,
      effort: "low",
    });
    if (ai) {
      const dims =
        ai.widthCm && ai.depthCm && ai.heightCm
          ? {
              w: Math.round(ai.widthCm),
              d: Math.round(ai.depthCm),
              h: Math.round(ai.heightCm),
            }
          : draft.dimsCm;
      draft = {
        ...draft,
        name: ai.name || draft.name,
        priceUsd: ai.priceUsd ?? draft.priceUsd,
        category: ai.category,
        dimsCm: dims,
        color: ai.color || draft.color,
        confidence: ai.confidence,
        method: "AI reading of the page",
      };
    }
  }

  return NextResponse.json({
    draft: {
      ...draft,
      url: url?.href ?? "",
      retailer: url ? retailerOf(url.hostname) : "other",
      imageUrl: typeof image === "string" ? image : undefined,
    },
    needsSize: !draft.dimsCm,
  });
}
