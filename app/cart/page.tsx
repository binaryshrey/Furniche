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

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-display text-4xl">Shopping list</h1>
        {!active ? (
          <p className="mt-4 text-muted">
            Nothing here yet.{" "}
            <Link href="/explore" className="underline">
              Pick a home
            </Link>{" "}
            and drag in some furniture.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>For {geometry?.name ?? label(active.sid)}</span>
              {withItems.length > 1 && (
                <select
                  id="cart-design"
                  value={active.sid}
                  onChange={(e) => setSid(e.target.value)}
                  className="rounded border border-line bg-card px-2 py-1"
                >
                  {withItems.map((d) => (
                    <option key={d.sid} value={d.sid}>
                      {label(d.sid)}
                    </option>
                  ))}
                </select>
              )}
              <Link
                href={
                  yardOf(active.sid)
                    ? `/outside/${yardOf(active.sid)}`
                    : `/space/${active.sid}`
                }
                className="underline"
              >
                {yardOf(active.sid) ? "Back to the yard" : "Back to the room"}
              </Link>
            </div>

            <div className="mt-8 space-y-8">
              {[...groups.entries()].map(([group, rows]) => (
                <section key={group}>
                  <div className="mb-2 flex items-baseline justify-between border-b border-line pb-1">
                    <h2 className="font-display text-xl">{groupLabel(group)}</h2>
                    <span className="num text-sm">{fmtUsd(rows.reduce((s, r) => s + r.qty * r.product.priceUsd, 0))}</span>
                  </div>
                  <ul className="divide-y divide-line">
                    {rows.map(({ product, qty }) => (
                      <li
                        key={product.id}
                        className="flex items-center gap-4 py-3"
                      >
                        <ProductSwatch product={product} size={52} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{product.name}</div>
                          <div className="num text-xs text-muted">
                            {fmtDims(product)} · price checked{" "}
                            {product.priceCheckedAt}
                          </div>
                        </div>
                        <div className="num w-24 text-right text-sm">
                          {qty} × {fmtUsd(product.priceUsd)}
                        </div>
                        {product.url ? (
                          <a href={product.url} target="_blank" rel="noreferrer" className="rounded-md border border-ink px-3 py-1.5 text-xs">
                            Buy at {RETAILER_LABEL[product.retailer]}
                          </a>
                        ) : (
                          <span className="w-[92px] text-center text-xs text-muted">No store link</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {finishes.length > 0 && (
                <section>
                  <div className="mb-2 flex items-baseline justify-between border-b border-line pb-1">
                    <h2 className="font-display text-xl">Paint and flooring</h2>
                    <span className="num text-sm">{fmtUsd(finishTotal)}</span>
                  </div>
                  <ul className="divide-y divide-line text-sm">
                    {finishes.map((f) => (
                      <li key={f.s.uid} className="flex justify-between py-2.5">
                        <span>
                          {f.m.name} · {f.room.label} ·{" "}
                          <span className="num">
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

            <div className="mt-10 flex items-center justify-between rounded-2xl border border-line bg-card p-5">
              <div>
                <div className="text-sm text-muted">Estimated total</div>
                <div className="num font-display text-3xl">
                  {fmtUsd(furnitureTotal + finishTotal)}
                </div>
              </div>
              <button
                onClick={copyList}
                className="rounded-lg btn-brand px-5 py-3 text-sm font-medium "
              >
                {copied ? "Copied" : "Copy shopping list"}
              </button>
            </div>
            <CapitalOneCheckout
              lines={[
                // Pieces from the shopper's photos have no store to pay.
                ...[...groups.entries()].flatMap(([retailer, rows]) => (retailer === 'photo' ? [] : [{ retailer, rows }])).map(({ retailer, rows }) => ({
                  retailer,
                  amountUsd: rows.reduce((s, r) => s + r.qty * r.product.priceUsd, 0),
                  description: `FurNiche AI: ${rows.map((r) => `${r.qty}x ${r.product.name.split(',')[0]}`).join(', ')}`,
                })),
                ...(finishTotal > 0 ? [{ retailer: 'other' as Retailer, amountUsd: finishTotal, description: 'FurNiche AI: paint and flooring' }] : []),
              ]}
            />
            <p className="mt-3 text-xs text-muted">FurNiche AI doesn&apos;t sell anything. Buy links open each store; prices are a sample and may have changed.</p>
          </>
        )}
      </main>
    </div>
  );
}
