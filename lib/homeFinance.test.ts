import { describe, expect, it } from 'vitest';
import { amortization, balanceAfter, buyVerdict, equity, monthlyPayment, moveInCosts, ownCost, prequalify, rentVerdict, rentVsBuy, valueFromComps, type FinanceProfile } from './homeFinance';

// The sandbox's demo mover: $5,700 a month, $2,082 of bills ($1,850 rent), about $10k to use.
const MOVER: FinanceProfile = { monthlyIncome: 5700, monthlyBills: 2082, housingNow: 1850, otherDebt: 0, cash: 9618, cardRoom: 1500, creditScore: 720 };
const HOUSTON = -95.36;

describe('home money', () => {
  it('pays a mortgage like the tables say', () => {
    expect(monthlyPayment(200_000, 6, 30)).toBeCloseTo(1199.1, 1);
    expect(monthlyPayment(200_000, 6, 15)).toBeCloseTo(1687.71, 1);
    expect(monthlyPayment(120_000, 0, 10)).toBe(1000);
    const years = amortization(200_000, 6, 30);
    expect(years).toHaveLength(30);
    expect(years.at(-1)!.balance).toBeLessThan(1);
    expect(years[0].interest).toBeGreaterThan(years[0].principal); // early payments are mostly interest
    expect(balanceAfter(200_000, 6, 30, 120)).toBeCloseTo(years[9].balance, 0);
  });

  it('adds Texas tax, insurance and PMI under 20% down', () => {
    const c = ownCost({ price: 300_000, downPct: 0.1, ratePct: 6.5, years: 30, lon: HOUSTON });
    expect(c.loan).toBe(270_000);
    expect(c.tax).toBeCloseTo((300_000 * 0.021) / 12, 6);
    expect(c.pmi).toBeGreaterThan(0);
    expect(ownCost({ price: 300_000, downPct: 0.2, ratePct: 6.5, years: 30, lon: HOUSTON }).pmi).toBe(0);
    expect(c.cashToClose).toBe(30_000 + 9_000);
    expect(c.monthly).toBeCloseTo(c.principalInterest + c.tax + c.insurance + c.pmi, 6);
  });

  it('calls a home within budget, a stretch or over by income and cash', () => {
    const cheap = ownCost({ price: 100_000, downPct: 0.035, ratePct: 6.3, years: 30, lon: HOUSTON });
    const dear = ownCost({ price: 600_000, downPct: 0.035, ratePct: 6.3, years: 30, lon: HOUSTON });
    expect(buyVerdict(MOVER, cheap).verdict).toBe('comfortable');
    const over = buyVerdict(MOVER, dear);
    expect(over.verdict).toBe('over');
    expect(over.reasons.length).toBeGreaterThan(0);
    expect(over.needIncome).toBeGreaterThan(MOVER.monthlyIncome);
    expect(over.needCash).toBeGreaterThan(MOVER.cash);
  });

  it('pre-qualifies at the lower of what income and cash allow', () => {
    const q = prequalify(MOVER, { downPct: 0.035, ratePct: 6.3, years: 30, lon: HOUSTON });
    expect(q.maxPrice).toBeGreaterThan(100_000);
    expect(q.maxPrice).toBeLessThanOrEqual(Math.min(q.byIncome, q.byCash));
    // at that price the payment fits the 28% rule
    const c = ownCost({ price: q.maxPrice, downPct: 0.035, ratePct: 6.3, years: 30, lon: HOUSTON });
    expect(c.monthly / MOVER.monthlyIncome).toBeLessThanOrEqual(0.2801);
  });

  it('judges rent by income and move-in cash', () => {
    expect(rentVerdict(MOVER, 1500).verdict).toBe('comfortable');
    expect(rentVerdict(MOVER, 2000).verdict).toBe('stretch');
    expect(rentVerdict(MOVER, 2600).verdict).toBe('over');
    expect(rentVerdict(MOVER, 1500).moveIn).toBe(3000);
  });

  it('finds when buying overtakes renting', () => {
    const r = rentVsBuy({ price: 280_000, rent: 2000, downPct: 0.2, ratePct: 6.3, years: 30, lon: HOUSTON, horizon: 15 });
    expect(r.rows).toHaveLength(15);
    expect(r.rows[0].buy).toBeGreaterThan(r.rows[0].rent); // closing costs make the first year dear
    if (r.breakEven != null) expect(r.rows[r.breakEven - 1].buy).toBeLessThan(r.rows[r.breakEven - 1].rent);
  });

  it('values a home from nearby homes and works out equity', () => {
    const comps = [180, 190, 200, 210, 220].map((pps, i) => ({ price: pps * 1500, sqft: 1500, lat: 29.8 + i * 0.001, lon: HOUSTON }));
    const v = valueFromComps({ sqft: 1400, lat: 29.8, lon: HOUSTON + 0.001, price: 300_000 }, comps)!;
    expect(v.value).toBe(280_000); // the middle $200 a square foot
    expect(v.low).toBeLessThanOrEqual(v.value);
    expect(v.high).toBeGreaterThanOrEqual(v.value);
    expect(valueFromComps({ sqft: 1400, lat: 40, lon: -70, price: null }, comps)).toBeNull(); // nothing nearby
    const e = equity(300_000, 200_000, 8, 20_000);
    expect(e.equity).toBe(100_000);
    expect(e.netIfSold).toBe(300_000 * 0.94 - 200_000);
    expect(e.helocRoom).toBe(40_000);
    expect(e.borrowMonthly).toBeGreaterThan(200);
  });

  it('lists move-in costs, leaving out what is zero', () => {
    const lines = moveInCosts({ housing: [{ label: 'First month', amount: 1500 }], beds: 2, furniture: 0, finishes: 800 });
    expect(lines.map((l) => l.label)).toEqual(['First month', 'Movers (local, 2 bedrooms)', 'Utility deposits and setup', 'Paint and flooring']);
  });
});
