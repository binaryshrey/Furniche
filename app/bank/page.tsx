"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import CapitalOneCard, { last4, spendable } from "@/components/bank/CapitalOneCard";
import { CategoryBars, CategoryIcon, Donut, Gauge, WeeklyBars } from "@/components/bank/Charts";
import CapitalOneLogo from "@/components/ui/CapitalOneLogo";
import { Logo } from "@/components/ui/Brand";
import { healthScore, money, summarize, type BankData, type BankTxnView } from "@/lib/bankSummary";
import type { BankAccount } from "@/lib/budget";

type View = "home" | "transactions" | "accounts" | "cards" | "insights";

const NAV: { id: View; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "M4 11l8-7 8 7v9H4zM10 20v-6h4v6" },
  { id: "transactions", label: "Transactions", icon: "M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l-3 3m3-3l3 3" },
  { id: "accounts", label: "Accounts", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6" },
  { id: "cards", label: "Cards", icon: "M3 6h18v12H3zM3 10h18M7 15h4" },
  { id: "insights", label: "Insights & Tips", icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" },
];

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ` ${time}`;
}

function Card({ title, action, children, className = "" }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-5 sm:p-6 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-xl">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function TxnRow({ t }: { t: BankTxnView }) {
  const incoming = t.direction === "in";
  return (
    <li className="flex items-center gap-3 py-3">
      <CategoryIcon category={t.category} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{t.merchant}</div>
        {t.note && <div className="truncate text-xs text-muted">{t.note}</div>}
        <div className="truncate text-xs text-muted">
          {t.category} · {when(t.at)} · {t.account}
          {t.sample && <span className="ml-2 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Sample</span>}
          {t.status !== "completed" && <span className="ml-2 text-warn">{t.status}</span>}
        </div>
      </div>
      <div className={`num shrink-0 text-sm font-medium ${incoming ? "rounded-md bg-ok/15 px-2 py-0.5 text-ok" : ""}`}>
        {incoming ? "+" : ""}
        {money(t.amount)}
      </div>
    </li>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="num font-display text-3xl">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

function AccountFacts({ a }: { a: BankAccount }) {
  const isCard = a.type === "Credit Card";
  const used = isCard && a.creditLimit ? a.balance / a.creditLimit : 0;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex justify-between">
        <span className="text-muted">{isCard ? "Balance owed" : "Current balance"}</span>
        <span className="num">{money(a.balance)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted">{isCard ? "Credit left" : "Available to spend"}</span>
        <span className="num">{money(spendable(a))}</span>
      </div>
      {isCard && (
        <>
          <div className="flex justify-between">
            <span className="text-muted">Credit limit</span>
            <span className="num">{money(a.creditLimit ?? 0)}</span>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted">
              <span>Utilisation</span>
              <span>{Math.round(used * 100)}% (keep under 30%)</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, used * 100)}%`, background: used > 0.3 ? "#ffc857" : "#5ad19a" }} />
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Rewards</span>
            <span className="num">{a.rewards.toLocaleString()} miles</span>
          </div>
        </>
      )}
      <div className="flex justify-between">
        <span className="text-muted">Account</span>
        <span className="num">
          {a.type} · •••• {last4(a.id)}
        </span>
      </div>
    </div>
  );
}

export default function BankPage() {
  const [data, setData] = useState<(BankData & { error?: string }) | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("home");
  const [idx, setIdx] = useState(0);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/bank")
      .then((r) => r.json())
      .then((d: BankData & { error?: string }) => {
        setData(d);
        const want = new URLSearchParams(window.location.search).get("account");
        const i = d.accounts.findIndex((a) => a.id === want);
        if (i >= 0) setIdx(i);
      })
      .catch(() => setFailed(true));
  }, []);

  const summary = useMemo(() => (data ? summarize(data.transactions) : null), [data]);
  const health = useMemo(() => (data && summary ? healthScore(data, summary) : null), [data, summary]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen">
      <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-6">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden h-6 w-px bg-line sm:block" />
          <CapitalOneLogo className="hidden h-6 w-auto sm:block" />
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Sandbox</span>
        </div>
        {data && (
          <div className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-sm">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-brand text-xs font-semibold text-white">FM</span>
            {data.holder}
          </div>
        )}
      </header>
      {body}
    </div>
  );

  if (failed) return shell(<p className="px-6 py-16 text-center text-muted">Couldn&apos;t load the banking data. Try again in a moment.</p>);
  if (!data || !summary || !health) return shell(<p className="px-6 py-16 text-center text-muted">Reading your Capital One accounts…</p>);

  const account = data.accounts[Math.min(idx, data.accounts.length - 1)];
  const recent = data.transactions.slice(0, 5);
  const net = data.accounts.reduce((s, a) => s + (a.type === "Credit Card" ? -a.balance : a.balance), 0);
  const shown = data.transactions.filter((t) => (filter === "all" || t.direction === filter) && (!q || `${t.merchant} ${t.category} ${t.account}`.toLowerCase().includes(q.toLowerCase())));

  const carousel = (
    <div>
      <button type="button" onClick={() => setView("cards")} aria-label={`${account.nickname}: open card details`} className="block w-full text-left">
        <CapitalOneCard account={account} />
      </button>
      <div className="mt-3 flex items-center justify-center gap-2" role="tablist" aria-label="Choose a card">
        {data.accounts.map((a, i) => (
          <button key={a.id} role="tab" aria-selected={i === idx} aria-label={a.nickname} onClick={() => setIdx(i)} className={`h-2 rounded-full transition-all ${i === idx ? "w-6 bg-ink" : "w-2 bg-white/25 hover:bg-white/40"}`} />
        ))}
      </div>
    </div>
  );

  const home = (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-6">
        <Card title="Balance">
          <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
            {carousel}
            <div className="space-y-6 sm:text-center">
              <Stat label={account.type === "Credit Card" ? "Balance owed" : "Current balance"} value={money(account.balance)} />
              <Stat label={account.type === "Credit Card" ? "Credit left" : "Available to spend"} value={money(spendable(account))} />
            </div>
          </div>
        </Card>
        <Card title="Financial Health Score" action={<button onClick={() => setView("insights")} className="text-sm underline">Why this score</button>}>
          <div className="grid items-center gap-6 sm:grid-cols-2">
            <div>
              <div className="text-sm font-medium">Smart tips</div>
              <ul className="mt-3 space-y-3">
                {health.tips.slice(0, 3).map((t) => (
                  <li key={t} className="flex gap-3 text-sm">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs">•</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <Gauge score={health.score} label={health.label} />
          </div>
        </Card>
        <Card title="Spending by week" action={<button onClick={() => setView("insights")} className="text-sm underline">See all</button>}>
          <WeeklyBars weekly={summary.weekly} />
        </Card>
        <Card title="Top merchants" action={<span className="text-sm text-muted">Last 30 days</span>}>
          <ul className="divide-y divide-line text-sm">
            {summary.topMerchants.map((m) => (
              <li key={m.merchant} className="flex items-center justify-between py-2.5">
                <span className="min-w-0 truncate">
                  {m.merchant}
                  <span className="ml-2 text-xs text-muted">{m.count}×</span>
                </span>
                <span className="num shrink-0">{money(m.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="space-y-6">
        <Card title="Savings vs Spending" action={<span className="text-sm text-muted">{summary.monthName}</span>}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-4">
              <div className="flex gap-8">
                <div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#7aa2ff]" />
                    Spent
                  </div>
                  <div className="num font-display text-2xl">
                    {money(summary.spent, false)} <span className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-xs">{summary.spentPct}%</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#5ad19a]" />
                    Saved
                  </div>
                  <div className="num font-display text-2xl">
                    {money(summary.saved, false)} <span className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-xs">{summary.savedPct}%</span>
                  </div>
                </div>
              </div>
              <p className="max-w-xs text-sm text-muted">
                {summary.spent > summary.income
                  ? `You've spent ${money(summary.spent - summary.income, false)} more than the ${money(summary.income, false)} you earned this month${summary.byCategory[0] ? `, mostly on ${summary.byCategory[0].category.toLowerCase()}` : ""}.`
                  : summary.savedPct >= 20
                    ? `You're doing great! You've saved ${summary.savedPct}% of your income this month.`
                    : `You've saved ${summary.savedPct}% of your income this month. Aim for 20%.`}
              </p>
            </div>
            <Donut spent={summary.spent} saved={summary.saved} centre={money(summary.income, false)} />
          </div>
        </Card>
        <Card title="Where it went" action={<span className="text-sm text-muted">Last 30 days</span>}>
          <CategoryBars rows={summary.byCategory.slice(0, 6)} />
        </Card>
        <Card title="Transactions" action={<button onClick={() => setView("transactions")} className="text-sm underline">See All</button>}>
          <ul className="divide-y divide-line">
            {recent.map((t) => (
              <TxnRow key={t.id} t={t} />
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );

  const transactions = (
    <Card title="Transactions" action={<span className="text-sm text-muted">{shown.length} shown</span>}>
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "in", "out"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1.5 text-sm ${filter === f ? "border-brand bg-brand/10" : "border-line hover:border-ink/30"}`}>
            {f === "all" ? "All" : f === "in" ? "Money in" : "Spending"}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search merchant or category" aria-label="Search transactions" className="ml-auto w-full rounded-full border border-line bg-paper px-4 py-1.5 text-sm sm:w-64" />
      </div>
      <ul className="mt-2 divide-y divide-line">
        {shown.slice(0, 80).map((t) => (
          <TxnRow key={t.id} t={t} />
        ))}
      </ul>
      {!shown.length && <p className="py-8 text-center text-sm text-muted">No transactions match.</p>}
    </Card>
  );

  const accounts = (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {data.accounts.map((a, i) => (
          <section key={a.id} className="rounded-2xl border border-line bg-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-lg">{a.nickname}</div>
                <div className="text-xs text-muted">
                  {a.type} · •••• {last4(a.id)}
                </div>
              </div>
              <button onClick={() => (setIdx(i), setView("cards"))} className="text-sm underline">
                View card
              </button>
            </div>
            <div className="mt-4">
              <AccountFacts a={a} />
            </div>
          </section>
        ))}
      </div>
      <div className="space-y-6">
        <Card title="Net position">
          <Stat label="Cash minus card balance" value={money(net)} sub={`Safe to spend on the move: ${money(data.budget.safeToSpend, false)}`} />
        </Card>
        <Card title="Upcoming bills" action={<span className="num text-sm text-muted">{money(data.budget.monthlyBills, false)} / month</span>}>
          <ul className="divide-y divide-line text-sm">
            {data.bills.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-2.5">
                <span>
                  {b.payee}
                  {b.due && <span className="ml-2 text-xs text-muted">due {new Date(b.due).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                </span>
                <span className="num">{money(b.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );

  const cards = (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {data.accounts.map((a, i) => (
        <section key={a.id} className={`rounded-2xl border bg-card p-5 ${i === idx ? "border-brand ring-1 ring-brand" : "border-line"}`}>
          <button onClick={() => setIdx(i)} className="block w-full text-left" aria-label={`Select ${a.nickname}`}>
            <CapitalOneCard account={a} />
          </button>
          <div className="mt-5">
            <AccountFacts a={a} />
          </div>
        </section>
      ))}
    </div>
  );

  const insights = (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Financial Health Score">
        <Gauge score={health.score} label={health.label} />
        <ul className="mt-6 divide-y divide-line text-sm">
          {health.parts.map((p) => (
            <li key={p.name} className="py-3">
              <div className="flex justify-between">
                <span className="font-medium">{p.name}</span>
                <span className="num text-muted">
                  {p.points}/{p.max}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(p.points / p.max) * 100}%` }} />
              </div>
              <div className="mt-1 text-xs text-muted">{p.note}</div>
            </li>
          ))}
        </ul>
      </Card>
      <div className="space-y-6">
        <Card title="Smart tips">
          <ul className="space-y-3">
            {health.tips.map((t) => (
              <li key={t} className="flex gap-3 text-sm">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-xs">•</span>
                {t}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Spending by week">
          <WeeklyBars weekly={summary.weekly} />
        </Card>
      </div>
      <Card title="Where it went (30 days)">
        <CategoryBars rows={summary.byCategory} />
      </Card>
      <Card title="Top merchants (30 days)">
        <ul className="divide-y divide-line text-sm">
          {summary.topMerchants.map((m) => (
            <li key={m.merchant} className="flex items-center justify-between py-2.5">
              <span>
                {m.merchant}
                <span className="ml-2 text-xs text-muted">{m.count}×</span>
              </span>
              <span className="num">{money(m.amount)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );

  const body = { home, transactions, accounts, cards, insights }[view];
  return shell(
    <div className="mx-auto flex max-w-[1500px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-10">
      <nav aria-label="Banking sections" className="flex shrink-0 gap-1 overflow-x-auto lg:sticky lg:top-6 lg:w-56 lg:flex-col lg:self-start lg:overflow-visible">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            aria-current={view === n.id ? "page" : undefined}
            className={`flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm transition ${view === n.id ? "bg-card font-semibold text-ink" : "text-muted hover:bg-card/60 hover:text-ink"}`}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={n.icon} />
            </svg>
            {n.label}
          </button>
        ))}
        <Link href="/cart" className="mt-3 hidden rounded-full border border-line px-5 py-3 text-center text-sm font-semibold hover:border-ink/40 lg:block">
          Back to cart
        </Link>
      </nav>
      <main className="min-w-0 flex-1">
        {data.error && <p className="mb-4 rounded-lg border border-warn/40 px-3 py-2 text-sm text-warn">{data.error}</p>}
        {body}
        {summary.hasSample && (
          <p className="mt-6 text-xs text-muted">
            {data.source === "nessie" ? "Balances, bills and purchases are live from your Capital One sandbox account. " : "Demo data. "}
            Rows marked <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] uppercase">Sample</span> are generated everyday activity so the spending pattern has history; they are not from your accounts.
          </p>
        )}
      </main>
    </div>,
  );
}
