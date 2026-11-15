'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { surfaceLines } from '@/components/design/SurfacesBox';
import { useFinance } from '@/components/finance/useFinance';
import { TopNav } from '@/components/ui/Brand';
import CapitalOneLogo from '@/components/ui/CapitalOneLogo';
import {
  ASSUME,
  VERDICT_LABEL,
  amortization,
  buyVerdict,
  equity,
  moveInCosts,
  ownCost,
  placeRates,
  prequalify,
  rentVerdict,
  rentVsBuy,
  usd,
  pct,
  valueFromComps,
  type FinanceProfile,
  type Verdict,
} from '@/lib/homeFinance';
import { useStore } from '@/lib/store';
import type { Listing, ModelGeometry } from '@/lib/types';

// A listing's money, with Capital One (the Nessie sandbox): what it costs a month and whether the
// mover can afford it, a mortgage they can apply for, renting it, renting against buying, the cash
// moving in takes, and for an owner its value and equity. Numbers from lib/homeFinance.ts.

type Home = Extract<Listing, { kind: 'home' }>;
type Apartment = Extract<Listing, { kind: 'apartment' }>;
type Tab = 'buy' | 'rent' | 'compare' | 'movein' | 'equity';
// What app/api/finance answers to an application or a new rent bill.
type ActResult = { loan: { id: string; status: string; amount: number }; reasons: string[]; bill: { due: string; replaced: string[] } };

const VERDICT_CLASS: Record<Verdict, string> = {
  comfortable: 'bg-ok/15 text-ok',
  stretch: 'bg-warn/15 text-warn',
  over: 'bg-bad/15 text-bad',
};
const thumb = (sid: string) => `https://my.matterport.com/api/v1/player/models/${sid}/thumb?width=640`;

function Badge({ v }: { v: Verdict }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${VERDICT_CLASS[v]}`}>{VERDICT_LABEL[v]}</span>;
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Slider({ label, value, min, max, step, show, onChange, id }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void; id: string }) {
  return (
    <label className="block text-sm" htmlFor={id}>
      <div className="flex justify-between">
        <span className="text-muted">{label}</span>
        <span className="num font-medium">{show}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[#fc7249]" />
    </label>
  );
}

// A ratio against its comfortable and limit marks.
function Meter({ label, value, good, limit }: { label: string; value: number; good: number; limit: number }) {
  const scale = Math.max(limit * 1.4, value * 1.05);
  const color = value <= good ? 'bg-ok' : value <= limit ? 'bg-warn' : 'bg-bad';
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span className="text-muted">{label}</span>
        <span className="num font-medium">{pct(value)}</span>
      </div>
      <div className="relative mt-1 h-2 rounded-full bg-panel">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.min(100, (value / scale) * 100)}%` }} />
        {[good, limit].map((m) => (
          <div key={m} className="absolute -top-1 h-4 w-px bg-ink/60" style={{ left: `${(m / scale) * 100}%` }} title={pct(m)} />
        ))}
      </div>
    </div>
  );
}

function Lines({ rows }: { rows: { label: string; amount: number; tone?: string }[] }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {rows.map((r) => (
        <li key={r.label} className="flex justify-between gap-3 py-2">
          <span className="text-muted">{r.label}</span>
          <span className={`num ${r.tone ?? ''}`}>{usd(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

// Simple line chart: series over x, with a legend.
function Chart({ series, xLabel, money = true }: { series: { label: string; color: string; points: [number, number][] }[]; xLabel: string; money?: boolean }) {
  const W = 560;
  const H = 200;
  const pad = { l: 64, r: 12, t: 10, b: 28 };
  const xs = series.flatMap((s) => s.points.map((p) => p[0]));
  const ys = series.flatMap((s) => s.points.map((p) => p[1]));
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(0, ...ys), Math.max(...ys) || 1];
  const X = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const Y = (y: number) => H - pad.b - ((y - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const fmt = (v: number) => (money ? (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : usd(v)) : String(Math.round(v)));
  const ticks = [y0, (y0 + y1) / 2, y1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={series.map((s) => s.label).join(' and ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={pad.l - 6} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" opacity={0.6}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {y0 < 0 && <line x1={pad.l} x2={W - pad.r} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.4} />}
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={2.5} points={s.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ')} />
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="currentColor" opacity={0.6}>
          {xLabel}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Finance({ params }: { params: { sid: string } }) {
  const sid = params.sid;
  const [fin, refresh] = useFinance();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [geometry, setGeometry] = useState<ModelGeometry | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  // Buying
  const [downPct, setDownPct] = useState(0.1);
  const [years, setYears] = useState<15 | 30>(30);
  const [rateEdit, setRateEdit] = useState<number | null>(null);
  const [offer, setOffer] = useState<number | null>(null);
  // Renting
  const [rent, setRent] = useState<number | null>(null);
  // Renting against buying
  const [horizon, setHorizon] = useState(7);
  const [rentGuess, setRentGuess] = useState<number | null>(null);
  // Owning
  const [owedEdit, setOwedEdit] = useState<number | null>(null);
  const [project, setProject] = useState<number | null>(null);
  // Capital One actions
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    fetch('/api/listings')
      .then((r) => r.json())
      .then((d) => setListings([...(d.homes ?? []), ...(d.apartments ?? [])]))
      .catch(() => setListings([]));
    fetch(`/api/models/${sid}`)
      .then((r) => r.json())
      .then((g) => !g.error && setGeometry(g))
      .catch(() => {});
  }, [sid]);

  const listing = listings?.find((l) => l.sid === sid) ?? null;
  const home = listing?.kind === 'home' ? (listing as Home) : null;
  const apt = listing?.kind === 'apartment' ? (listing as Apartment) : null;
  useEffect(() => {
    if (listing && !tab) setTab(listing.kind === 'home' ? 'buy' : 'rent');
  }, [listing, tab]);

  const design = useStore((s) => s.designs[sid]);
  const productOf = useStore((s) => s.product);
  // This home's design from stores; pieces from My Scans are the mover's own and cost nothing here.
  const furniture = hydrated && design ? design.items.reduce((s, i) => {
    const p = productOf(i.productId);
    return s + (p && p.source !== 'photo' ? p.priceUsd : 0);
  }, 0) : 0;
  const finishes = hydrated && design ? surfaceLines(geometry, design.surfaces, design.doors).reduce((s, f) => s + f.cost, 0) : 0;

  const lon = listing?.lon ?? null;
  const rate = rateEdit ?? (fin ? (years === 30 ? fin.rates.rate30 : fin.rates.rate15) : 7);
  const price = offer ?? home?.price ?? 0;
  const profile: FinanceProfile | null = fin?.profile ?? null;

  // A rented home's comparison: the median price of homes for sale nearby.
  const nearbyPrice = useMemo(() => {
    if (!apt || !listings || apt.lat == null || apt.lon == null) return null;
    const near = listings.filter((l): l is Home => l.kind === 'home' && l.price != null && Math.hypot((l.lat - apt.lat!) * 111, (l.lon - apt.lon!) * 96) < 3);
    const prices = near.map((h) => h.price!).sort((a, b) => a - b);
    return prices.length >= 3 ? prices[Math.floor(prices.length / 2)] : null;
  }, [apt, listings]);

  if (!listings || !fin || !profile) return <Shell sid={sid}>{!listings || !fin ? <p className="text-muted">Loading your Capital One accounts…</p> : null}</Shell>;
  if (!listing) return <Shell sid={sid}><p className="text-muted">This listing isn&apos;t in the index.</p></Shell>;

  const rentNow = rent ?? apt?.rentMin ?? 0;
  const cost = home ? ownCost({ price, downPct, ratePct: rate, years, lon }) : null;
  const buy = cost ? buyVerdict(profile, cost) : null;
  const rentV = apt ? rentVerdict(profile, rentNow) : null;
  const verdict = (buy?.verdict ?? rentV?.verdict)!;
  const monthly = cost?.monthly ?? rentNow;
  const loansHere = fin.loans.filter((l) => l.description.includes(listing.address));

  async function act(body: object, done: (json: ActResult) => string) {
    setBusy(true);
    setResult(null);
    const res = await fetch('/api/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const json = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok || !json || json.error) return setResult({ ok: false, text: json?.error ?? 'Capital One could not be reached.' });
    setResult({ ok: true, text: done(json) });
    refresh();
  }

  const title = home ? home.address : `${apt!.community ?? apt!.address} · ${apt!.unitName}`;
  const tabs: { id: Tab; label: string }[] = home
    ? [
        { id: 'buy', label: 'Afford & mortgage' },
        { id: 'compare', label: 'Rent vs buy' },
        { id: 'movein', label: 'Move-in' },
        { id: 'equity', label: 'Sell & equity' },
      ]
    : [
        { id: 'rent', label: 'Rent' },
        { id: 'compare', label: 'Rent vs buy' },
        { id: 'movein', label: 'Move-in' },
      ];

  return (
    <Shell sid={sid}>
      {/* The listing and its verdict */}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumb(sid)} alt="" className="h-32 w-full rounded-2xl object-cover sm:w-48" />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl">{title}</h1>
          <div className="mt-1 text-muted">
            {home ? `${home.price ? usd(home.price) : 'Price on request'} · ${[home.beds && `${home.beds} bd`, home.baths && `${home.baths} ba`, home.sqft && `${home.sqft.toLocaleString()} sq ft`].filter(Boolean).join(' · ')}` : `${usd(apt!.rentMin ?? 0)}${apt!.rentMax && apt!.rentMax !== apt!.rentMin ? `–${usd(apt!.rentMax)}` : ''} a month · ${apt!.city}`}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge v={verdict} />
            <span className="num text-lg font-semibold">{usd(monthly)}/mo</span>
            <span className="text-sm text-muted">{home ? `with ${pct(downPct)} down, ${years}-year at ${rate}%` : 'rent'}</span>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <CapitalOneLogo className="h-6 w-auto" />
          <Link href={`/space/${sid}`} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-ink/40">
            Walk through and furnish
          </Link>
        </div>
      </div>
      {fin.error && <p className="mt-3 text-sm text-warn">{fin.error}</p>}

      <nav className="mt-6 flex flex-wrap gap-1 border-b border-line" role="tablist" aria-label="Money for this home">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => (setTab(t.id), setResult(null))} className={`border-b-2 px-3 py-2 text-sm ${tab === t.id ? 'border-brand font-semibold' : 'border-transparent text-muted hover:text-ink'}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {tab === 'buy' && home && cost && buy && (
          <>
            <Panel title="Your mortgage">
              <div className="space-y-4">
                <label className="block text-sm" htmlFor="fin-price">
                  <span className="text-muted">Price (or your offer)</span>
                  <input id="fin-price" type="number" min={10000} step={1000} value={Math.round(price)} onChange={(e) => setOffer(Number(e.target.value) || null)} className="num mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2" />
                </label>
                <Slider id="fin-down" label="Down payment" value={downPct} min={0.035} max={0.3} step={0.005} show={`${pct(downPct)} · ${usd(cost.down)}`} onChange={setDownPct} />
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted">Term</span>
                  {([30, 15] as const).map((y) => (
                    <button key={y} onClick={() => (setYears(y), setRateEdit(null))} className={`rounded-full px-3 py-1 ${years === y ? 'bg-ink text-paper' : 'border border-line'}`}>
                      {y} years
                    </button>
                  ))}
                  <label className="ml-auto flex items-center gap-1.5" htmlFor="fin-rate">
                    <span className="text-muted">Rate</span>
                    <input id="fin-rate" type="number" step={0.05} min={1} max={15} value={rate} onChange={(e) => setRateEdit(Number(e.target.value) || null)} className="num w-20 rounded-lg border border-line bg-paper px-2 py-1" />%
                  </label>
                </div>
                <p className="text-xs text-muted">
                  {fin.rates.asOf ? `This week's average ${years}-year rate: ${years === 30 ? fin.rates.rate30 : fin.rates.rate15}% (${fin.rates.source}, ${fin.rates.asOf}).` : `Rates are a recent average.`}
                </p>
              </div>
            </Panel>

            <Panel title="Each month">
              <MonthBar parts={[
                { label: 'Principal and interest', amount: cost.principalInterest, color: '#fc7249' },
                { label: `Property tax (${pct(placeRates(lon).tax)} a year)`, amount: cost.tax, color: '#5b8def' },
                { label: 'Home insurance', amount: cost.insurance, color: '#46b98b' },
                ...(cost.pmi > 0 ? [{ label: 'Mortgage insurance (under 20% down)', amount: cost.pmi, color: '#c58af9' }] : []),
              ]} />
              <div className="mt-3 flex justify-between border-t border-line pt-3 font-semibold">
                <span>Total</span>
                <span className="num">{usd(cost.monthly)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">You pay {usd(profile.housingNow)} in rent today.</p>
            </Panel>

            <Panel title="Can you afford it?" action={<Badge v={buy.verdict} />}>
              <div className="space-y-3">
                <Meter label="Housing ÷ income (28% comfortable, 33% the most)" value={buy.front} good={ASSUME.frontEnd} limit={ASSUME.frontEndMax} />
                <Meter label="All debts ÷ income (36% comfortable, 43% the limit)" value={buy.back} good={ASSUME.backEnd} limit={ASSUME.backEndMax} />
                <Lines rows={[
                  { label: 'Cash to close (down payment and closing costs)', amount: cost.cashToClose },
                  { label: `Plus ${ASSUME.reserveMonths} months of payments kept in reserve`, amount: ASSUME.reserveMonths * cost.monthly },
                  { label: 'Cash you can use (checking after bills, and savings)', amount: profile.cash, tone: buy.cashShort > 0 ? 'text-bad' : 'text-ok' },
                ]} />
                {buy.reasons.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{buy.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                ) : (
                  <p className="text-sm text-ok">Comfortably within lenders&apos; guidelines.</p>
                )}
                {buy.verdict !== 'comfortable' && (
                  <p className="text-sm">
                    What it would take: about <span className="num font-semibold">{usd(buy.needIncome * 12)}</span> a year of income (you have <span className="num">{usd(profile.monthlyIncome * 12)}</span>) and <span className="num font-semibold">{usd(buy.needCash)}</span> in the bank.
                  </p>
                )}
              </div>
            </Panel>

            <PreQual profile={profile} downPct={downPct} rate={rate} years={years} lon={lon} />

            <Panel title="Paying it off">
              <Amortization loan={cost.loan} rate={rate} years={years} />
            </Panel>

            <Panel title="Apply with Capital One" action={<span className="text-xs text-muted">sandbox</span>}>
              <p className="text-sm text-muted">
                A {years}-year fixed loan of <span className="num text-ink">{usd(cost.loan)}</span> at {rate}%, <span className="num text-ink">{usd(cost.principalInterest)}</span> a month. Capital One reviews it by the same rules, with a simulated credit score of {profile.creditScore}.
              </p>
              <button
                id="fin-apply"
                disabled={busy}
                onClick={() =>
                  act({ action: 'mortgage', address: home.address, price, downPct, ratePct: rate, years, lon }, (j) =>
                    j.loan.status === 'approved' ? `Approved: loan ${j.loan.id.slice(-6)} for ${usd(j.loan.amount)}.` : j.loan.status === 'pending' ? `Under review: loan ${j.loan.id.slice(-6)}. ${j.reasons.join(' ')}` : `Declined. ${j.reasons.join(' ')}`,
                  )
                }
                className="mt-3 w-full rounded-lg btn-brand px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
              >
                {busy ? 'Applying…' : 'Apply for this mortgage'}
              </button>
              {result && <p className={`mt-2 text-sm ${result.ok ? 'text-ok' : 'text-bad'}`}>{result.text}</p>}
              {loansHere.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
                  {loansHere.map((l) => (
                    <li key={l.id}>
                      <span className={l.status === 'approved' ? 'text-ok' : l.status === 'declined' ? 'text-bad' : 'text-warn'}>{l.status}</span> · {usd(l.amount)} · {usd(l.monthly)}/mo · {l.description.split(' · ')[0]}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}

        {tab === 'rent' && apt && rentV && (
          <>
            <Panel title="Your rent">
              {apt.rentMax && apt.rentMin && apt.rentMax > apt.rentMin ? (
                <Slider id="fin-rent" label="Unit's rent" value={rentNow} min={apt.rentMin} max={apt.rentMax} step={5} show={usd(rentNow)} onChange={setRent} />
              ) : (
                <p className="num text-2xl font-semibold">{usd(rentNow)} a month</p>
              )}
              <div className="mt-4 space-y-3">
                <Meter label="Rent ÷ income (30% comfortable, 40% the most)" value={rentV.share} good={ASSUME.rentShare} limit={ASSUME.rentShareMax} />
                <Lines rows={[
                  { label: 'Income a month', amount: profile.monthlyIncome },
                  { label: 'Bills without your current rent', amount: profile.monthlyBills - profile.housingNow },
                  { label: 'This rent', amount: rentNow },
                  { label: 'Left each month', amount: profile.monthlyIncome - (profile.monthlyBills - profile.housingNow) - rentNow, tone: 'font-semibold' },
                ]} />
              </div>
            </Panel>
            <Panel title="Can you afford it?" action={<Badge v={rentV.verdict} />}>
              <Lines rows={[
                { label: 'First month', amount: rentNow },
                { label: `Security deposit (${ASSUME.depositMonths} month)`, amount: rentNow * ASSUME.depositMonths },
                { label: 'Cash you can use', amount: profile.cash, tone: rentV.moveIn > profile.cash ? 'text-bad' : 'text-ok' },
              ]} />
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{rentV.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              <button
                id="fin-rent-bill"
                disabled={busy}
                onClick={() => act({ action: 'rent', payee: apt.community ?? apt.address, amount: rentNow }, (j) => `Rent of ${usd(rentNow)} set up as a monthly bill on your checking, first due ${j.bill.due}.${j.bill.replaced.length ? ` It replaces ${j.bill.replaced.join(' and ')}, now cancelled.` : ''}`)}
                className="mt-4 w-full rounded-lg btn-brand px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
              >
                {busy ? 'Setting up…' : 'Set up rent with Capital One'}
              </button>
              {result && <p className={`mt-2 text-sm ${result.ok ? 'text-ok' : 'text-bad'}`}>{result.text}</p>}
            </Panel>
          </>
        )}

        {tab === 'compare' && (
          <Compare
            price={home ? price : nearbyPrice}
            rent={home ? (rentGuess ?? Math.round((price * ASSUME.priceToRent) / 10) * 10) : rentNow}
            onRent={home ? setRentGuess : undefined}
            downPct={downPct}
            rate={fin.rates.rate30}
            lon={lon}
            horizon={horizon}
            setHorizon={setHorizon}
            home={!!home}
          />
        )}

        {tab === 'movein' && (
          <MoveIn
            profile={profile}
            housing={home && cost ? [
              { label: `Down payment (${pct(downPct)})`, amount: cost.down },
              { label: 'Closing costs', amount: cost.closing },
            ] : [
              { label: 'First month of rent', amount: rentNow },
              { label: 'Security deposit', amount: rentNow * ASSUME.depositMonths },
            ]}
            beds={home?.beds ?? null}
            furniture={furniture}
            finishes={finishes}
            sid={sid}
          />
        )}

        {tab === 'equity' && home && (
          <Equity
            home={home}
            listings={listings}
            loanOwed={loansHere.find((l) => l.status === 'approved')?.amount ?? null}
            owedEdit={owedEdit}
            setOwed={setOwedEdit}
            rate={fin.rates.rate30 + 1}
            project={project ?? (finishes > 0 ? Math.round(finishes) : 25_000)}
            setProject={setProject}
            fromDesign={project == null && finishes > 0}
          />
        )}
      </div>
      <p className="mt-8 text-xs text-muted">
        Capital One&apos;s sandbox ({fin.source === 'nessie' ? 'your sandbox accounts' : 'demo accounts'}): rates, approvals and the credit score are simulated; taxes and insurance are typical for the area. Not an offer of credit.
      </p>
    </Shell>
  );
}

function Shell({ sid, children }: { sid: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Link href={`/space/${sid}`} className="text-sm text-muted underline">
          ← Back to the home
        </Link>
        <div className="mt-4">{children}</div>
      </main>
    </div>
  );
}

function MonthBar({ parts }: { parts: { label: string; amount: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.amount, 0) || 1;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full">
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.amount / total) * 100}%`, background: p.color }} title={p.label} />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            <span className="flex-1 text-muted">{p.label}</span>
            <span className="num">{usd(p.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreQual({ profile, downPct, rate, years, lon }: { profile: FinanceProfile; downPct: number; rate: number; years: number; lon: number | null }) {
  const q = prequalify(profile, { downPct, ratePct: rate, years, lon });
  return (
    <Panel title="Pre-qualification">
      <p className="text-sm text-muted">From your Capital One accounts: {usd(profile.monthlyIncome * 12)} a year of income and {usd(profile.cash)} you can use, at {pct(downPct)} down.</p>
      <p className="num mt-3 font-display text-4xl">{usd(q.maxPrice)}</p>
      <p className="text-sm text-muted">the most you pre-qualify for, about {usd(q.monthly)} a month</p>
      <p className="mt-2 text-xs text-muted">
        Income allows up to {usd(q.byIncome)}; cash allows up to {usd(q.byCash)}.{q.byCash < q.byIncome ? ' Saving more is what raises it.' : ' More income is what raises it.'}
      </p>
      {q.maxPrice > 0 && (
        <Link href={`/search?q=${encodeURIComponent(`homes under $${Math.round(q.maxPrice / 1000)}k`)}`} className="mt-3 inline-block text-sm underline">
          Homes in your range
        </Link>
      )}
    </Panel>
  );
}

function Amortization({ loan, rate, years }: { loan: number; rate: number; years: number }) {
  const rows = amortization(loan, rate, years);
  const interest = rows.reduce((s, r) => s + r.interest, 0);
  return (
    <>
      <Chart
        xLabel="Years"
        series={[
          { label: 'Still owed', color: '#fc7249', points: [[0, loan], ...rows.map((r) => [r.year, r.balance] as [number, number])] },
          { label: 'Interest paid so far', color: '#5b8def', points: [[0, 0], ...rows.map((r, i) => [r.year, rows.slice(0, i + 1).reduce((s, x) => s + x.interest, 0)] as [number, number])] },
        ]}
      />
      <p className="mt-2 text-sm text-muted">
        Over {years} years you pay <span className="num text-ink">{usd(interest)}</span> in interest on <span className="num text-ink">{usd(loan)}</span>.
      </p>
    </>
  );
}

function Compare({ price, rent, onRent, downPct, rate, lon, horizon, setHorizon, home }: { price: number | null; rent: number; onRent?: (v: number) => void; downPct: number; rate: number; lon: number | null; horizon: number; setHorizon: (v: number) => void; home: boolean }) {
  if (!price) return <Panel title="Rent vs buy"><p className="text-sm text-muted">Not enough homes for sale nearby to compare.</p></Panel>;
  const r = rentVsBuy({ price, rent, downPct: Math.max(downPct, 0.035), ratePct: rate, years: 30, lon, horizon: 15 });
  const at = r.rows[horizon - 1];
  const better = at.buy < at.rent ? 'Buying' : 'Renting';
  return (
    <>
      <Panel title="Rent vs buy">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {home ? 'Owning this home' : `Buying a typical home nearby (${usd(price)})`} against renting {home ? 'one like it' : 'this one'}. Counted: everything paid, less what you would get back: the owner&apos;s equity after selling costs, the renter&apos;s down payment invested at {pct(ASSUME.investReturn)}. Homes gain {pct(ASSUME.appreciation)} a year, rents {pct(ASSUME.rentGrowth)}.
          </p>
          {onRent ? (
            <label className="block text-sm" htmlFor="fin-rent-guess">
              <span className="text-muted">Rent for a home like this (about {pct(ASSUME.priceToRent * 12)} of its price a year here)</span>
              <input id="fin-rent-guess" type="number" min={300} step={10} value={rent} onChange={(e) => onRent(Number(e.target.value) || 0)} className="num mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2" />
            </label>
          ) : (
            <p className="text-sm">Rent: <span className="num">{usd(rent)}</span> a month</p>
          )}
          <Slider id="fin-horizon" label="Years you'd stay" value={horizon} min={1} max={15} step={1} show={`${horizon} year${horizon > 1 ? 's' : ''}`} onChange={setHorizon} />
        </div>
      </Panel>
      <Panel title={`${better} comes out ahead after ${horizon} year${horizon > 1 ? 's' : ''}`}>
        <Chart xLabel="Years" series={[
          { label: 'Buying: net cost', color: '#fc7249', points: r.rows.map((x) => [x.year, x.buy] as [number, number]) },
          { label: 'Renting: net cost', color: '#5b8def', points: r.rows.map((x) => [x.year, x.rent] as [number, number]) },
        ]} />
        <p className="mt-2 text-sm">
          {r.breakEven ? (
            <>Buying pays off after <span className="font-semibold">{r.breakEven} year{r.breakEven > 1 ? 's' : ''}</span>.</>
          ) : (
            'Within 15 years buying does not overtake renting.'
          )}{' '}
          At {horizon} years: buying costs <span className="num">{usd(at.buy)}</span>, renting <span className="num">{usd(at.rent)}</span>.
        </p>
      </Panel>
    </>
  );
}

function MoveIn({ profile, housing, beds, furniture, finishes, sid }: { profile: FinanceProfile; housing: { label: string; amount: number }[]; beds: number | null; furniture: number; finishes: number; sid: string }) {
  const lines = moveInCosts({ housing, beds, furniture, finishes });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const fromCash = Math.min(total, profile.cash);
  const onCard = Math.min(total - fromCash, profile.cardRoom);
  const short = total - fromCash - onCard;
  const surplus = Math.max(0, profile.monthlyIncome - profile.monthlyBills);
  return (
    <>
      <Panel title="What moving in takes">
        <Lines rows={lines} />
        <div className="mt-2 flex justify-between border-t border-line pt-3 font-semibold">
          <span>Total</span>
          <span className="num">{usd(total)}</span>
        </div>
        <p className="mt-2 text-xs text-muted">
          Furniture and finishes are this home&apos;s design from stores; pieces from My Scans are yours and aren&apos;t counted.{' '}
          {furniture + finishes === 0 && (
            <Link href={`/space/${sid}`} className="underline">
              Furnish it
            </Link>
          )}
        </p>
      </Panel>
      <Panel title="How you'd pay for it" action={<CapitalOneLogo className="h-5 w-auto" />}>
        <Lines rows={[
          { label: 'From checking and savings', amount: fromCash },
          ...(onCard > 0 ? [{ label: 'On your card (keeping it under 30% used)', amount: onCard }] : []),
          ...(short > 0 ? [{ label: 'Still to save', amount: short, tone: 'text-bad' }] : []),
        ]} />
        <p className="mt-3 text-sm">
          {short <= 0
            ? onCard > 0
              ? 'Covered, with some on the card: pay it off in full to avoid interest.'
              : 'Covered from your accounts.'
            : surplus > 0
              ? `Saving ${usd(surplus)} a month (what's left after bills), you'd have it in about ${Math.ceil(short / surplus)} month${Math.ceil(short / surplus) > 1 ? 's' : ''}.`
              : 'Your bills take all your income, so this needs more savings first.'}
        </p>
        <Link href="/bank" className="mt-3 inline-block text-sm underline">
          Your Capital One accounts
        </Link>
      </Panel>
    </>
  );
}

function Equity({ home, listings, loanOwed, owedEdit, setOwed, rate, project, setProject, fromDesign }: { home: Home; listings: Listing[]; loanOwed: number | null; owedEdit: number | null; setOwed: (v: number) => void; rate: number; project: number; setProject: (v: number) => void; fromDesign: boolean }) {
  const comps = listings.filter((l): l is Home => l.kind === 'home' && l.price != null && l.sqft != null).map((l) => ({ price: l.price!, sqft: l.sqft!, lat: l.lat, lon: l.lon }));
  const est = valueFromComps({ sqft: home.sqft, lat: home.lat, lon: home.lon, price: home.price }, comps);
  const value = est?.value ?? home.price ?? 0;
  const owed = owedEdit ?? loanOwed ?? Math.round(value * 0.8);
  const e = equity(value, owed, rate, project);
  return (
    <>
      <Panel title="What it's worth">
        {est ? (
          <>
            <p className="num font-display text-4xl">{usd(est.value)}</p>
            <p className="text-sm text-muted">
              from {est.count} homes for sale within 3 km, by price per square foot (most between {usd(est.low)} and {usd(est.high)})
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Too few similar homes nearby to compare; using the asking price.</p>
        )}
        {home.price && <p className="mt-2 text-sm">Asking price: <span className="num">{usd(home.price)}</span>{est && ` (${home.price > est.value ? 'above' : 'below'} the estimate by ${usd(Math.abs(home.price - est.value))})`}</p>}
      </Panel>
      <Panel title="If you owned it">
        <div className="space-y-3">
          <Slider id="fin-owed" label={loanOwed != null && owedEdit == null ? 'Owed on your Capital One mortgage' : 'Still owed on the mortgage'} value={owed} min={0} max={Math.round(value)} step={1000} show={usd(owed)} onChange={setOwed} />
          <Lines rows={[
            { label: 'Your equity', amount: e.equity, tone: 'font-semibold' },
            { label: `Left if you sold (after ${pct(ASSUME.selling)} selling costs)`, amount: e.netIfSold },
            { label: 'Home equity you could borrow (up to 80% of value)', amount: e.helocRoom },
          ]} />
        </div>
      </Panel>
      <Panel title="Renovate with a home equity loan">
        <Slider id="fin-project" label={fromDesign ? 'Paint and flooring in your design' : 'Project cost'} value={project} min={1000} max={Math.max(100_000, project)} step={500} show={usd(project)} onChange={setProject} />
        <p className="mt-3 text-sm">
          {project <= e.helocRoom ? (
            <>
              A 10-year home equity loan at about {rate.toFixed(2)}%: <span className="num font-semibold">{usd(e.borrowMonthly)}</span> a month.
            </>
          ) : (
            <span className="text-warn">More than the {usd(e.helocRoom)} of equity you could borrow against.</span>
          )}
        </p>
      </Panel>
    </>
  );
}
