"use client";
import { useEffect, useState } from "react";
import { RETAILER_LABEL } from "@/catalog/products";
import { useBudget } from "@/components/chat/BudgetStrip";
import SwipeToPay from "@/components/shop/SwipeToPay";
import CapitalOneCard, { last4, spendable } from "@/components/bank/CapitalOneCard";
import CapitalOneLogo from "@/components/ui/CapitalOneLogo";
import type { Retailer } from "@/lib/types";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// Checkout against the mover's Capital One accounts (Nessie sandbox): pick an account, check it
// against the move-in budget, then swipe to post one purchase per store. No card number is ever
// typed in, shown for real or stored; nothing real is charged.
export default function CapitalOneCheckout({
  lines,
  className = "",
}: {
  lines: { retailer: Retailer; amountUsd: number; description: string }[];
  className?: string;
}) {
  const total = lines.reduce((s, l) => s + l.amountUsd, 0);
  const [done, setDone] = useState<{ id?: string; retailer: Retailer; amountUsd: number; status: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlan, setShowPlan] = useState(false);
  const budget = useBudget(total, done);
  const [account, setAccount] = useState("");
  // Start on the first of checking, card, savings that can cover the order; else the roomiest account.
  useEffect(() => {
    if (account || !budget?.accounts.length) return;
    const first = (["Checking", "Credit Card", "Savings"] as const)
      .map((t) => budget.accounts.find((a) => a.type === t))
      .find((a) => a && spendable(a) >= total);
    setAccount((first ?? [...budget.accounts].sort((a, b) => spendable(b) - spendable(a))[0]).id);
  }, [budget, account, total]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: account, lines }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Checkout failed");
      setDone(j.purchases);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shell = `rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6 ${className}`;
  if (!budget)
    return (
      <section className={shell}>
        <div className="flex items-center justify-between">
          <CapitalOneLogo className="h-6 w-auto text-ink" />
        </div>
        <p className="mt-4 text-sm text-muted">Reading your Capital One accounts…</p>
      </section>
    );

  const selected = budget.accounts.find((a) => a.id === account) ?? budget.accounts[0];
  const live = budget.source === "nessie";
  const canCover = !!selected && spendable(selected) >= total;
  const statusText = budget.status === "comfortable" ? "Within what you can spend" : budget.status === "stretch" ? "Needs the credit card" : "Over budget";
  const statusColor = budget.status === "comfortable" ? "text-ok" : budget.status === "stretch" ? "text-warn" : "text-bad";

  if (done)
    return (
      <section className={shell} aria-live="polite">
        <div className="flex flex-col items-center py-4 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-ok/15 text-ok">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h2 className="mt-3 font-display text-2xl">Payment complete</h2>
          <p className="mt-1 text-sm text-muted">
            {usd(done.reduce((s, d) => s + d.amountUsd, 0))} paid from {selected?.nickname} in the Capital One sandbox.
          </p>
        </div>
        <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
          {done.map((d, i) => (
            <li key={d.id ?? i} className="flex items-center justify-between px-3 py-2.5">
              <span>
                {RETAILER_LABEL[d.retailer]} <span className="text-muted">· {d.status}</span>
              </span>
              <span className="num">{usd(d.amountUsd)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-center text-[11px] text-muted">Sandbox money (Nessie). Nothing real was charged.</p>
      </section>
    );

  return (
    <section className={shell}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Pay with</h2>
        <CapitalOneLogo className="h-6 w-auto text-ink" />
      </div>

      {selected && (
        <a
          href={`/bank?account=${encodeURIComponent(selected.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the ${selected.nickname} banking dashboard in a new tab`}
          className="group relative mt-4 block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CapitalOneCard account={selected} className="transition group-hover:-translate-y-0.5 group-hover:shadow-2xl" />
          <span className="pointer-events-none absolute bottom-3 right-4 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white opacity-0 backdrop-blur transition group-hover:opacity-100 group-focus-visible:opacity-100">
            Open dashboard ↗
          </span>
        </a>
      )}

      <fieldset className="mt-4">
        <legend className="sr-only">Account</legend>
        <div className="space-y-2">
          {budget.accounts.map((a) => {
            const on = a.id === account;
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${on ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-line hover:border-ink/30"}`}
              >
                <input type="radio" name="pay-account" value={a.id} checked={on} onChange={() => setAccount(a.id)} className="accent-[#fc7249]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.nickname}</span>
                  <span className="block text-xs text-muted">
                    {a.type} · •••• {last4(a.id)}
                  </span>
                </span>
                <span className="num text-right text-xs text-muted">{a.type === "Credit Card" ? `${usd(spendable(a))} left` : usd(a.available)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4 rounded-xl border border-line bg-paper/60 p-3 text-sm">
        <button type="button" onClick={() => setShowPlan(!showPlan)} aria-expanded={showPlan} className="flex w-full items-center justify-between text-left">
          <span className={`font-medium ${statusColor}`}>{statusText}</span>
          <span className="text-xs text-muted">
            Safe to spend <span className="num text-ink">{usd(budget.safeToSpend)}</span> {showPlan ? "▴" : "▾"}
          </span>
        </button>
        {showPlan && (
          <div className="mt-2 border-t border-line pt-2">
            <p className="text-xs text-muted">
              After {usd(budget.monthlyBills)} of bills and a $500 cushion.
              {budget.rentShare != null && ` Rent is ${Math.round(budget.rentShare * 100)}% of income.`}
            </p>
            <ul className="mt-2 divide-y divide-line text-xs">
              {budget.plan.map((p) => (
                <li key={p.label} className="flex justify-between py-1.5">
                  <span>
                    {p.label} <span className="text-muted">· {p.from}</span>
                  </span>
                  <span className="num">{usd(p.amount)}</span>
                </li>
              ))}
            </ul>
            {budget.notes.map((n) => (
              <p key={n} className="mt-1 text-[11px] text-muted">
                {n}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5">
        <SwipeToPay label={`Swipe to pay ${usd(total)}`} disabled={!total || !live || !account || !canCover} busy={busy} onConfirm={pay} />
      </div>
      {live && selected && !canCover && total > 0 && (
        <p role="status" className="mt-2 text-xs text-warn">
          {selected.nickname} has {usd(spendable(selected))}, not enough for {usd(total)}. Choose another account above.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-bad">
          {error}
        </p>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0" aria-hidden>
          <rect x="4" y="10" width="16" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        {live ? "Sandbox money (Nessie): nothing real is charged, and no card number is entered or stored." : "Set NESSIE_API_KEY to turn on sandbox payments."}
      </p>
    </section>
  );
}
