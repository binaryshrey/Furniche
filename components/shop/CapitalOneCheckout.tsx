'use client';
import { useEffect, useState } from 'react';
import { RETAILER_LABEL } from '@/catalog/products';
import { useBudget } from '@/components/chat/BudgetStrip';
import type { Retailer } from '@/lib/types';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Pay-now / pay-later plan from the mover's Capital One accounts, and a sandbox checkout that
// posts one Nessie purchase per store.
export default function CapitalOneCheckout({ lines }: { lines: { retailer: Retailer; amountUsd: number; description: string }[] }) {
  const total = lines.reduce((s, l) => s + l.amountUsd, 0);
  const [done, setDone] = useState<{ retailer: Retailer; amountUsd: number; status: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budget = useBudget(total, done);
  const [account, setAccount] = useState('');
  useEffect(() => {
    if (!account && budget?.accounts.length) setAccount(budget.accounts.find((a) => a.type === 'Checking')?.id ?? budget.accounts[0].id);
  }, [budget, account]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/budget', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account, lines }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Checkout failed');
      setDone(j.purchases);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!budget) return null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl">Move-in budget · Capital One</h2>
        <span className={`text-sm ${budget.status === 'comfortable' ? 'text-ok' : budget.status === 'stretch' ? 'text-warn' : 'text-bad'}`}>
          {budget.status === 'comfortable' ? 'Within what you can spend' : budget.status === 'stretch' ? 'Needs the credit card' : 'Over budget'}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Safe to spend now: <span className="num text-ink">{usd(budget.safeToSpend)}</span> after {usd(budget.monthlyBills)} of bills and a $500 cushion.
        {budget.rentShare != null && ` Rent is ${Math.round(budget.rentShare * 100)}% of income.`}
      </p>
      <ul className="mt-3 divide-y divide-line text-sm">
        {budget.plan.map((p) => (
          <li key={p.label} className="flex justify-between py-2">
            <span>
              {p.label} <span className="text-muted">· {p.from}</span>
            </span>
            <span className="num">{usd(p.amount)}</span>
          </li>
        ))}
      </ul>
      {budget.notes.map((n) => (
        <p key={n} className="mt-1 text-xs text-muted">
          {n}
        </p>
      ))}

      {done ? (
        <div className="mt-4 rounded-lg border border-ok/40 p-3 text-sm">
          <div className="font-medium text-ok">Paid in the Capital One sandbox</div>
          <ul className="mt-1 text-xs text-muted">
            {done.map((d) => (
              <li key={d.retailer}>
                {RETAILER_LABEL[d.retailer]} · {usd(d.amountUsd)} · {d.status}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select id="pay-account" value={account} onChange={(e) => setAccount(e.target.value)} className="rounded-md border border-line bg-paper px-2 py-2 text-sm">
            {budget.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nickname} · {a.type === 'Credit Card' ? `${usd((a.creditLimit ?? 0) - a.balance)} credit` : usd(a.available)}
              </option>
            ))}
          </select>
          <button onClick={pay} disabled={busy || !total || budget.source !== 'nessie'} className="rounded-lg btn-brand px-4 py-2 text-sm font-medium disabled:opacity-40">
            {busy ? 'Paying…' : `Pay ${usd(total)} with Capital One`}
          </button>
          <span className="text-[11px] text-muted">{budget.source === 'nessie' ? 'Sandbox money (Nessie); nothing real is charged.' : 'Set NESSIE_API_KEY to enable.'}</span>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
    </section>
  );
}
