"use client";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABEL } from "@/catalog/products";
import { useStore } from "@/lib/store";
import type { Category, Product, Retailer } from "@/lib/types";

type Draft = {
  name: string;
  priceUsd: number | null;
  category: Category;
  dimsCm: { w: number; d: number; h: number } | null;
  color: string;
  confidence: string;
  method: string;
  url: string;
  retailer: Retailer;
};

// Product data handed over by the bookmarklet, via /import (see app/import/page.tsx).
export const IMPORT_KEY = "furniche-import";
export type PagePayload = {
  url: string;
  name?: string;
  price?: string;
  text?: string;
  ld?: string[];
};

// Runs on the store's page in the shopper's browser, so stores that block servers still work.
// It reads JSON-LD, the title, a price and any lines that mention dimensions, then opens Furniche.
function bookmarklet(origin: string): string {
  const js = `(()=>{const q=s=>document.querySelector(s);const m=p=>q('meta[property="'+p+'"],meta[name="'+p+'"]')?.content||'';const ld=[...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>s.textContent);const price=(q('#corePrice_feature_div .a-offscreen,#corePriceDisplay_desktop_feature_div .a-offscreen,.a-price .a-offscreen,[data-test="product-price"],[itemprop=price]')?.textContent||m('product:price:amount')||'').trim();const lines=document.body.innerText.split('\\n').filter(l=>/dimension|width|depth|height|\\d\\s*("|in|inch|cm)?\\s*[LWDH]?\\s*[x\u00d7]/i.test(l)).slice(0,60).join('\\n');const p={url:location.href,name:(q('#productTitle')?.textContent||m('og:title')||document.title).trim(),price,text:lines.slice(0,8000),ld:ld.map(s=>s.slice(0,100000)).slice(0,10)};window.open('${origin}/import#'+encodeURIComponent(JSON.stringify(p)))})()`;
  return "javascript:" + encodeURIComponent(js);
}

export default function ImportLink() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const addImported = useStore((s) => s.addImportedProduct);
  const setPending = useStore((s) => s.setPending);
  const marklet = useRef<HTMLAnchorElement>(null);

  // React refuses javascript: hrefs in JSX, so the bookmarklet link is set directly.
  useEffect(() => {
    marklet.current?.setAttribute("href", bookmarklet(window.location.origin));
  });

  // Pick up a product sent by the bookmarklet.
  useEffect(() => {
    let payload: PagePayload | null = null;
    try {
      payload = JSON.parse(localStorage.getItem(IMPORT_KEY) ?? "null");
      localStorage.removeItem(IMPORT_KEY);
    } catch {
      /* storage unavailable */
    }
    if (payload?.url) {
      setOpen(true);
      setUrl(payload.url);
      run(payload);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(page?: PagePayload) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          page ?? { url: url || undefined, text: text || undefined },
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error);
        setBlocked(!!json.blocked);
        if (json.nameHint && !text) setText(json.nameHint + "\n");
        return;
      }
      setDraft({
        ...json.draft,
        dimsCm: json.draft.dimsCm ?? { w: 0, d: 0, h: 0 },
      });
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (
      !draft?.dimsCm ||
      !draft.dimsCm.w ||
      !draft.dimsCm.d ||
      !draft.dimsCm.h
    ) {
      setError("Enter width, depth and height before adding.");
      return;
    }
    const p: Product = {
      id: "imp-" + Math.random().toString(36).slice(2, 9),
      source: "imported",
      retailer: draft.retailer,
      name: draft.name,
      url: draft.url,
      priceUsd: draft.priceUsd ?? 0,
      priceCheckedAt: new Date().toISOString().slice(0, 10),
      category: draft.category,
      dimsCm: draft.dimsCm,
      color: draft.color,
      styles: [],
      placement: ["mirror", "wall-art"].includes(draft.category)
        ? "wall"
        : "floor",
      standIn: true,
    };
    addImported(p);
    setPending(p.id);
    setDraft(null);
    setUrl("");
    setText("");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-dashed border-ink/40 px-3 py-2 text-sm hover:bg-card"
      >
        + Paste a product link from any store
      </button>
    );
  }

  const dim = (k: "w" | "d" | "h", label: string) => (
    <label className="flex flex-col text-[11px] text-muted">
      {label} (cm)
      <input
        id={`imp-${k}`}
        type="number"
        min={1}
        value={draft?.dimsCm?.[k] || ""}
        onChange={(e) =>
          draft &&
          setDraft({
            ...draft,
            dimsCm: {
              ...(draft.dimsCm ?? { w: 0, d: 0, h: 0 }),
              [k]: +e.target.value,
            },
          })
        }
        className="mt-0.5 w-full rounded border border-line bg-card px-2 py-1 text-sm text-ink"
      />
    </label>
  );

  return (
    <div className="space-y-2 rounded-lg border border-line bg-card p-3 text-sm">
      {!draft ? (
        <>
          <input
            id="imp-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.ikea.com/us/en/p/…"
            className="w-full rounded border border-line px-2 py-1.5"
          />
          {error && <p className="text-xs text-warn">{error}</p>}
          {blocked && (
            <>
              <div className="rounded-md bg-panel p-2 text-[11px] leading-snug text-muted">
                Drag{' '}
                <a ref={marklet} onClick={(e) => e.preventDefault()} className="whitespace-nowrap rounded-full bg-ink px-2 py-0.5 font-semibold text-paper" title="Drag me to your bookmarks bar">
                  + Add to FurNiche AI
                </a>{' '}
                to your bookmarks bar once. Then open any product page (Amazon, Wayfair, Target…) and click it.
              </div>
              <textarea
                id="imp-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="…or paste the product name, price and the “Product Dimensions” line from the page"
                className="h-20 w-full rounded border border-line px-2 py-1.5 text-xs"
              />
            </>
          )}
          <div className="flex gap-2">
            <button
              disabled={busy || (!url && !text)}
              onClick={() => run()}
              className="flex-1 rounded btn-brand px-3 py-1.5  disabled:opacity-40"
            >
              {busy ? "Reading the page…" : "Import"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="rounded border border-line px-3 py-1.5"
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <input
            id="imp-name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded border border-line px-2 py-1 font-medium"
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col text-[11px] text-muted">
              Price (USD)
              <input
                id="imp-price"
                type="number"
                value={draft.priceUsd ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, priceUsd: +e.target.value })
                }
                className="mt-0.5 rounded border border-line px-2 py-1 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col text-[11px] text-muted">
              Type
              <select
                id="imp-cat"
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value as Category })
                }
                className="mt-0.5 rounded border border-line px-1 py-1 text-sm text-ink"
              >
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {dim("w", "Width")}
            {dim("d", "Depth")}
            {dim("h", "Height")}
          </div>
          <p className="text-[11px] text-muted">
            Read from {draft.method}. Confidence: {draft.confidence}. Check the
            size against the store page; the 3D shape is a generic stand-in at
            this exact size.
          </p>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={add}
              className="flex-1 rounded btn-brand px-3 py-1.5 "
            >
              Add and place
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded border border-line px-3 py-1.5"
            >
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
