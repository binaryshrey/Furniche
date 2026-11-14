'use client';
import { useEffect, useState } from 'react';
import type { MoveInBudget } from '@/lib/budget';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const TONE: Record<MoveInBudget['status'], string> = { comfortable: 'text-ok', stretch: 'text-warn', over: 'text-bad' };
const LABEL: Record<MoveInBudget['status'], string> = { comfortable: 'Within budget', stretch: 'Needs the card', over: 'Over budget' };

// Move-in budget from Capital One (Nessie): what the design costs against what is safe to spend.
export function useBudget(planned: number, refreshKey: unknown) {
  const [budget, setBudget] = useState<(MoveInBudget & { error?: string }) | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/budget?planned=${Math.round(planned)}`)
        .then((r) => r.json())
        .then(setBudget)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [planned, refreshKey]);
  return budget;
}

export default function BudgetStrip({ budget, planned }: { budget: MoveInBudget | null; planned: number }) {
  const [open, setOpen] = useState(false);
  if (!budget) return <div className="border-b border-line px-3 py-2 text-[11px] text-muted">Reading your Capital One accounts…</div>;
  const share = budget.safeToSpend > 0 ? Math.min(1, planned / budget.safeToSpend) : 1;
  return (
    <div className="border-b border-line px-3 py-2">
      <button onClick={() => setOpen(!open)} className="flex w-full items-baseline justify-between text-left" aria-expanded={open}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Move-in budget · Capital One</span>
        <span className={`text-xs font-medium ${TONE[budget.status]}`}>{LABEL[budget.status]}</span>
      </button>
      <div className="mt-1 flex items-baseline justify-between text-xs">
        <span>
          Design <span className="num font-medium">{usd(planned)}</span>
        </span>
        <span className="text-muted">
          safe to spend <span className="num font-medium text-ink">{usd(budget.safeToSpend)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div className={`h-full ${budget.status === 'comfortable' ? 'bg-ok' : budget.status === 'stretch' ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${share * 100}%` }} />
      </div>
      {open && (
        <div className="mt-2 space-y-1 text-[11px] text-muted">
          {budget.accounts.map((a) => (
            <div key={a.id} className="flex justify-between">
              <span>{a.nickname}</span>
              <span className="num">{a.type === 'Credit Card' ? `${usd((a.creditLimit ?? 0) - a.balance)} credit` : usd(a.available)}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span>Bills this month</span>
            <span className="num">{usd(budget.monthlyBills)}</span>
          </div>
          {budget.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          <p>{budget.source === 'nessie' ? 'Live from the Capital One Nessie sandbox.' : 'Demo numbers. Set NESSIE_API_KEY for live accounts.'}</p>
        </div>
      )}
    </div>
  );
}
