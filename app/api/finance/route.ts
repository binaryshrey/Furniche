import { NextResponse } from 'next/server';
import type { MoveInBudget } from '@/lib/budget';
import { buyVerdict, ownCost, rentVerdict, usd, type FinanceProfile } from '@/lib/homeFinance';
import { addRentBill, applyHomeLoan, homeLoans, loadBudget, nessieAvailable, type HomeLoan } from '@/lib/nessie';
import { mortgageRates } from '@/lib/rates';

// The mover's money for the finance page and the listings' affordability: income, bills, the cash
// a move can use, this week's mortgage rates and any home loans, from the Capital One sandbox
// (or its demo customer when NESSIE_API_KEY isn't set). The credit score is simulated.
const CREDIT_SCORE = 720;

function profileOf(b: MoveInBudget): FinanceProfile {
  const savings = b.accounts.filter((a) => a.type === 'Savings').reduce((s, a) => s + a.available, 0);
  const cards = b.accounts.filter((a) => a.type === 'Credit Card').reduce((s, a) => s + Math.max(0, a.balance), 0);
  return {
    monthlyIncome: b.monthlyIncome,
    monthlyBills: b.monthlyBills,
    housingNow: b.rent ?? 0,
    otherDebt: Math.round(cards * 0.03), // a card's minimum payment
    cash: Math.round(b.cashFree + savings), // a home can take all of savings
    cardRoom: b.cardRoom,
    creditScore: CREDIT_SCORE,
  };
}

async function load(): Promise<{ profile: FinanceProfile; loans: HomeLoan[]; source: 'nessie' | 'demo'; error?: string }> {
  const budget = await loadBudget(0);
  const loans = budget.source === 'nessie' ? await homeLoans().catch(() => []) : [];
  return { profile: profileOf(budget), loans, source: budget.source, error: budget.error };
}

export async function GET() {
  const [data, rates] = await Promise.all([load(), mortgageRates()]);
  return NextResponse.json({ ...data, rates });
}

type Body =
  | { action: 'mortgage'; address: string; price: number; downPct: number; ratePct: number; years: number; lon: number | null }
  | { action: 'rent'; payee: string; amount: number };

// Apply for a mortgage (the server decides, by the same rules the page shows) or set up rent.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: 'Nothing to do.' }, { status: 400 });
  if (!nessieAvailable()) return NextResponse.json({ error: 'Set NESSIE_API_KEY in .env.local to use the Capital One sandbox.' }, { status: 400 });
  const { profile } = await load();
  try {
    if (body.action === 'mortgage') {
      const ok = [body.price, body.downPct, body.ratePct, body.years].every((v) => Number.isFinite(v)) && body.price > 10_000 && body.downPct >= 0.03 && body.downPct < 1 && [15, 30].includes(body.years);
      if (!ok) return NextResponse.json({ error: 'Check the price, down payment and term.' }, { status: 400 });
      const c = ownCost({ price: body.price, downPct: body.downPct, ratePct: body.ratePct, years: body.years, lon: body.lon });
      const v = buyVerdict(profile, c);
      const status = v.verdict === 'comfortable' ? 'approved' : v.verdict === 'stretch' ? 'pending' : 'declined';
      const loan = await applyHomeLoan({
        amount: c.loan,
        monthly: c.principalInterest,
        status,
        creditScore: profile.creditScore,
        description: `${body.years}-year fixed at ${body.ratePct}% · ${body.address} · ${usd(body.price)}, ${Math.round(body.downPct * 100)}% down`,
      });
      return NextResponse.json({ loan, reasons: v.reasons });
    }
    if (body.action === 'rent') {
      if (!(body.amount > 100 && body.amount < 50_000) || !body.payee) return NextResponse.json({ error: 'Check the rent.' }, { status: 400 });
      const v = rentVerdict(profile, body.amount);
      const bill = await addRentBill({ payee: body.payee, amount: body.amount });
      return NextResponse.json({ bill, verdict: v.verdict });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
