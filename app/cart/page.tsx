"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { RETAILER_LABEL } from "@/catalog/products";
import { surfaceLines } from "@/components/design/SurfacesBox";
import CapitalOneCheckout from "@/components/shop/CapitalOneCheckout";
import ProductSwatch from "@/components/shop/ProductSwatch";
import { fmtDims, fmtUsd } from "@/components/shop/ShopPanel";
import { TopNav } from "@/components/ui/Brand";
import { useStore } from "@/lib/store";
import type { ModelGeometry, Product, Retailer } from "@/lib/types";

export default function Cart() {
  const designs = useStore((s) => s.designs);
  const productOf = useStore((s) => s.product);
  const [sid, setSid] = useState<string | null>(null);
  const [geometry, setGeometry] = useState<ModelGeometry | null>(null);
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);
  const withItems = Object.values(designs)
    .filter((d) => d.items.length || d.surfaces.length)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = withItems.find((d) => d.sid === sid) ?? withItems[0];

  // Outdoor designs are keyed out:<listingId> and have no Matterport scan.
  const yardOf = (designSid: string) =>
    designSid.startsWith("out:") ? designSid.slice(4) : null;
  const label = (designSid: string) =>
    yardOf(designSid) ? `Yard of listing ${yardOf(designSid)}` : designSid;

  useEffect(() => {
    setGeometry(null);
    if (!active || yardOf(active.sid)) return;
    fetch(`/api/models/${active.sid}`)
      .then((r) => r.json())
      .then((g) => !g.error && setGeometry(g));
  }, [active?.sid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hydrated) return null;

  const counts = new Map<string, { product: Product; qty: number }>();
  for (const it of active?.items ?? []) {
    const p = productOf(it.productId);
    if (!p) continue;
    counts.set(p.id, { product: p, qty: (counts.get(p.id)?.qty ?? 0) + 1 });
  }
  // Pieces made from the shopper's photos have no store, so they get a group of their own.
  const groupOf = (p: Product): Retailer | 'photo' => (p.source === 'photo' ? 'photo' : p.retailer);
  const groupLabel = (g: Retailer | 'photo') => (g === 'photo' ? 'From your photos' : RETAILER_LABEL[g]);
  const groups = new Map<Retailer | 'photo', { product: Product; qty: number }[]>();
  for (const row of counts.values()) groups.set(groupOf(row.product), [...(groups.get(groupOf(row.product)) ?? []), row]);
  const finishes = active ? surfaceLines(geometry, active.surfaces, active.doors) : [];
  const furnitureTotal = [...counts.values()].reduce((s, r) => s + r.qty * r.product.priceUsd, 0);
  const finishTotal = finishes.reduce((s, f) => s + f.cost, 0);

  function copyList() {
    const lines = [...groups.entries()].flatMap(([group, rows]) => [
      `${groupLabel(group)}:`,
      ...rows.map((x) => `  ${x.qty} × ${x.product.name} (${fmtUsd(x.product.priceUsd)}) ${x.product.url}`.trimEnd()),
    ]);
    finishes.forEach((f) =>
      lines.push(
        `${f.m.name} for ${f.room.label}: ${f.qty} ${f.unit} (${fmtUsd(f.cost)})`,
      ),
    );
    lines.push(`Total: ${fmtUsd(furnitureTotal + finishTotal)}`);
    navigator.clipboard
      ?.writeText(lines.join("\n"))
      .then(() => (setCopied(true), setTimeout(() => setCopied(false), 1800)));
  }

  const itemCount = [...counts.values()].reduce((s, r) => s + r.qty, 0);
  const total = furnitureTotal + finishTotal;
  const payLines = [
    // Pieces from the shopper's photos have no store to pay.
    ...[...groups.entries()]
      .flatMap(([retailer, rows]) => (retailer === "photo" ? [] : [{ retailer, rows }]))
      .map(({ retailer, rows }) => ({
        retailer,
        amountUsd: rows.reduce((s, r) => s + r.qty * r.product.priceUsd, 0),
        description: `FurNiche AI: ${rows.map((r) => `${r.qty}x ${r.product.name.split(",")[0]}`).join(", ")}`,
      })),
    ...(finishTotal > 0 ? [{ retailer: "other" as Retailer, amountUsd: finishTotal, description: "FurNiche AI: paint and flooring" }] : []),
  ];
  const sum = (rows: { product: Product; qty: number }[]) => rows.reduce((s, r) => s + r.qty * r.product.priceUsd, 0);

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {!active ? (
          <>
            <h1 className="font-display text-4xl">Your cart</h1>
            <p className="mt-4 text-muted">
              Nothing here yet.{" "}
              <Link href="/" className="underline">
                Pick a home
              </Link>{" "}
              and drag in some furniture.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div>
                <h1 className="font-display text-4xl">Your cart</h1>
                <p className="mt-1 text-sm text-muted">
                  {itemCount} {itemCount === 1 ? "piece" : "pieces"} for {geometry?.name ?? label(active.sid)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {withItems.length > 1 && (
                  <select
                    id="cart-design"
                    aria-label="Design"
                    value={active.sid}
                    onChange={(e) => setSid(e.target.value)}
                    className="rounded-lg border border-line bg-card px-2 py-1.5"
                  >
                    {withItems.map((d) => (
                      <option key={d.sid} value={d.sid}>
                        {label(d.sid)}
                      </option>
                    ))}
                  </select>
                )}
                <Link href={yardOf(active.sid) ? `/outside/${yardOf(active.sid)}` : `/space/${active.sid}`} className="text-muted underline hover:text-ink">
                  {yardOf(active.sid) ? "Back to the yard" : "Back to the room"}
                </Link>
              </div>
            </div>

            <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
              <div className="space-y-6">
                {[...groups.entries()].map(([group, rows]) => (
                  <section key={group} className="overflow-hidden rounded-2xl border border-line bg-card">
                    <div className="flex items-baseline justify-between border-b border-line px-4 py-3 sm:px-5">
                      <h2 className="font-display text-lg">{groupLabel(group)}</h2>
                      <span className="num text-sm text-muted">{fmtUsd(sum(rows))}</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {rows.map(({ product, qty }) => (
                        <li key={product.id} className="flex items-center gap-4 px-4 py-4 sm:px-5">
                          <ProductSwatch product={product} size={72} />
                          <div className="min-w-0 flex-1">
                            <div className="font-medium leading-snug">{product.name}</div>
                            <div className="num mt-1 text-xs text-muted">
                              {fmtDims(product)} · price checked {product.priceCheckedAt}
                            </div>
                            {product.url ? (
                              <a href={product.url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-xs text-muted underline hover:text-ink">
                                View at {group === "photo" ? "the store" : RETAILER_LABEL[product.retailer]}
                              </a>
                            ) : (
                              <span className="mt-1.5 inline-block text-xs text-muted">No store link</span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="num font-medium">{fmtUsd(qty * product.priceUsd)}</div>
                            {qty > 1 && (
                              <div className="num text-xs text-muted">
                                {qty} × {fmtUsd(product.priceUsd)}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}

                {finishes.length > 0 && (
                  <section className="overflow-hidden rounded-2xl border border-line bg-card">
                    <div className="flex items-baseline justify-between border-b border-line px-4 py-3 sm:px-5">
                      <h2 className="font-display text-lg">Paint and flooring</h2>
                      <span className="num text-sm text-muted">{fmtUsd(finishTotal)}</span>
                    </div>
                    <ul className="divide-y divide-line text-sm">
                      {finishes.map((f) => (
                        <li key={f.s.uid} className="flex justify-between gap-4 px-4 py-3 sm:px-5">
                          <span>
                            {f.m.name} · {f.room.label} ·{" "}
                            <span className="num text-muted">
                              {f.qty} {f.unit}
                            </span>
                          </span>
                          <span className="num">{fmtUsd(f.cost)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              <aside className="space-y-4 lg:sticky lg:top-6">
                <section className="rounded-2xl border border-line bg-card p-5 sm:p-6">
                  <h2 className="font-display text-xl">Order summary</h2>
                  <dl className="mt-4 space-y-2 text-sm">
                    {[...groups.entries()].map(([group, rows]) => (
                      <div key={group} className="flex justify-between">
                        <dt className="text-muted">{groupLabel(group)}</dt>
                        <dd className="num">{fmtUsd(sum(rows))}</dd>
                      </div>
                    ))}
                    {finishTotal > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-muted">Paint and flooring</dt>
                        <dd className="num">{fmtUsd(finishTotal)}</dd>
                      </div>
                    )}
                    <div className="flex items-baseline justify-between border-t border-line pt-3">
                      <dt className="font-medium">Estimated total</dt>
                      <dd className="num font-display text-2xl">{fmtUsd(total)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-[11px] text-muted">Shipping and tax are set by each store.</p>
                  <button onClick={copyList} className="mt-4 w-full rounded-lg border border-line px-4 py-2.5 text-sm font-medium hover:border-ink/40">
                    {copied ? "Copied" : "Copy shopping list"}
                  </button>
                </section>

                <CapitalOneCheckout lines={payLines} />
                <p className="px-1 text-[11px] leading-snug text-muted">
                  FurNiche AI doesn&apos;t sell anything. Payments here use Capital One&apos;s sandbox, so no real money moves. Buy links open each store; prices are a sample and may have changed.
                </p>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
