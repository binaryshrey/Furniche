import 'server-only';
import type { Rates } from './homeFinance';

// This week's average US mortgage rates (Freddie Mac's survey, published free by FRED), kept
// for half a day. Falls back to recent levels when FRED can't be reached.
const FALLBACK: Rates = { rate30: 7.1, rate15: 6.45, asOf: null, source: 'recent average' };
let kept: { at: number; rates: Rates } | null = null;

async function latest(series: string): Promise<{ date: string; value: number } | null> {
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const rows = (await res.text()).trim().split('\n').slice(1).map((l) => l.split(','));
  for (let i = rows.length - 1; i >= 0; i--) {
    const value = Number(rows[i][1]);
    if (Number.isFinite(value) && value > 0) return { date: rows[i][0], value };
  }
  return null;
}

export async function mortgageRates(): Promise<Rates> {
  if (kept && Date.now() - kept.at < 12 * 3600_000) return kept.rates;
  const [r30, r15] = await Promise.all([latest('MORTGAGE30US'), latest('MORTGAGE15US')]);
  const rates = r30 && r15 ? { rate30: r30.value, rate15: r15.value, asOf: r30.date, source: 'Freddie Mac weekly average (FRED)' } : FALLBACK;
  kept = { at: Date.now(), rates };
  return rates;
}
