// Home money for a listing: what it costs a month, whether the mover can afford it, how big a
// mortgage they qualify for, renting against buying, what moving in takes, and, for an owner, the
// home's value and equity. Pure functions, fed by the Capital One sandbox (lib/nessie.ts) and
// weekly mortgage rates (lib/rates.ts). Rules of thumb lenders use; estimates, not offers.

export type FinanceProfile = {
  monthlyIncome: number; // gross, from paychecks
  monthlyBills: number; // every recurring bill, housing included
  housingNow: number; // today's rent or mortgage payment
  otherDebt: number; // monthly payments on other loans and cards
  cash: number; // checking and savings the move can draw on (after this month's bills and a cushion)
  cardRoom: number; // card spend that keeps it under 30% used
  creditScore: number; // simulated: the sandbox has none
};

export type Rates = { rate30: number; rate15: number; asOf: string | null; source: string }; // percent

export const ASSUME = {
  closing: 0.03, // buyer's closing costs, share of price
  selling: 0.06, // agent fees and closing when selling
  pmiRate: 0.006, // a year, on the loan, while under 20% down
  frontEnd: 0.28, // housing ÷ income: comfortable
  frontEndMax: 0.33, // stretch
  backEnd: 0.36, // housing + other debt ÷ income: comfortable
  backEndMax: 0.43, // most lenders' limit
  rentShare: 0.3, // rent ÷ income: comfortable
  rentShareMax: 0.4,
  reserveMonths: 2, // housing payments kept in the bank after closing
  depositMonths: 1, // renter's security deposit
  appreciation: 0.03,
  rentGrowth: 0.03,
  investReturn: 0.05,
  maintenance: 0.01, // a year, share of value
  priceToRent: 0.0062, // a month: a Houston home rents for about 0.62% of its price
};

// Property tax and insurance by place: Texas is high on both, California lower.
export function placeRates(lon: number | null): { tax: number; insurance: number } {
  return lon != null && lon < -114 ? { tax: 0.012, insurance: 0.004 } : { tax: 0.021, insurance: 0.01 };
}

export function monthlyPayment(principal: number, annualRatePct: number, years: number): number {
  if (principal <= 0) return 0;
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  return r === 0 ? principal / n : (principal * r) / (1 - Math.pow(1 + r, -n));
}

export type Mortgage = { price: number; downPct: number; ratePct: number; years: number; lon: number | null; hoa?: number };
export type OwnCost = {
  down: number;
  loan: number;
  principalInterest: number;
  tax: number;
  insurance: number;
  pmi: number;
  hoa: number;
  monthly: number;
  closing: number;
  cashToClose: number;
};

export function ownCost(m: Mortgage): OwnCost {
  const { tax, insurance } = placeRates(m.lon);
  const down = m.price * m.downPct;
  const loan = m.price - down;
  const principalInterest = monthlyPayment(loan, m.ratePct, m.years);
  const parts = {
    tax: (m.price * tax) / 12,
    insurance: (m.price * insurance) / 12,
    pmi: m.downPct < 0.2 ? (loan * ASSUME.pmiRate) / 12 : 0,
    hoa: m.hoa ?? 0,
  };
  const closing = m.price * ASSUME.closing;
  return { down, loan, principalInterest, ...parts, monthly: principalInterest + parts.tax + parts.insurance + parts.pmi + parts.hoa, closing, cashToClose: down + closing };
}

export type Verdict = 'comfortable' | 'stretch' | 'over';
export const VERDICT_LABEL: Record<Verdict, string> = { comfortable: 'Within budget', stretch: 'A stretch', over: 'Over budget' };

// Buying: lenders' debt-to-income ratios, and whether there is the cash to close with reserves.
export function buyVerdict(p: FinanceProfile, c: OwnCost): { verdict: Verdict; front: number; back: number; cashShort: number; needIncome: number; needCash: number; reasons: string[] } {
  const income = Math.max(p.monthlyIncome, 1);
  const front = c.monthly / income;
  const back = (c.monthly + p.otherDebt) / income;
  const needCash = c.cashToClose + ASSUME.reserveMonths * c.monthly;
  const cashShort = Math.max(0, needCash - p.cash);
  // What it would take: the income at which it is comfortable.
  const needIncome = Math.max(c.monthly / ASSUME.frontEnd, (c.monthly + p.otherDebt) / ASSUME.backEnd);
  const reasons: string[] = [];
  let verdict: Verdict = 'comfortable';
  if (front > ASSUME.frontEnd || back > ASSUME.backEnd) verdict = 'stretch';
  if (front > ASSUME.frontEndMax || back > ASSUME.backEndMax) verdict = 'over';
  if (front > ASSUME.frontEnd) reasons.push(`Housing would be ${pct(front)} of income (lenders like 28% or less).`);
  if (back > ASSUME.backEnd) reasons.push(`All debts would be ${pct(back)} of income (36% or less is comfortable, 43% the usual limit).`);
  if (cashShort > 0) {
    reasons.push(`Short ${usd(cashShort)} for the down payment, closing costs and ${ASSUME.reserveMonths} months in reserve.`);
    if (verdict === 'comfortable') verdict = 'stretch';
    if (cashShort > c.cashToClose * 0.5) verdict = 'over';
  }
  return { verdict, front, back, cashShort, needIncome, needCash, reasons };
}

// Renting: rent against income, and the cash to move in.
export function rentVerdict(p: FinanceProfile, rent: number): { verdict: Verdict; share: number; moveIn: number; reasons: string[] } {
  const share = rent / Math.max(p.monthlyIncome, 1);
  const moveIn = rent * (1 + ASSUME.depositMonths);
  const reasons: string[] = [];
  let verdict: Verdict = share <= ASSUME.rentShare ? 'comfortable' : share <= ASSUME.rentShareMax ? 'stretch' : 'over';
  reasons.push(`Rent would be ${pct(share)} of income (30% or less is the usual guideline).`);
  if (moveIn > p.cash) {
    reasons.push(`Moving in takes ${usd(moveIn)} (first month and deposit); ${usd(p.cash)} is free to use.`);
    verdict = 'over';
  }
  return { verdict, share, moveIn, reasons };
}

// The most a home can cost: the lower of what income allows (28% / 36%) and what the cash allows
// (down payment, closing, reserves).
export function prequalify(p: FinanceProfile, terms: { downPct: number; ratePct: number; years: number; lon: number | null }): { maxPrice: number; byIncome: number; byCash: number; monthly: number } {
  const per = ownCost({ price: 1, ...terms }); // monthly cost and cash per dollar of price
  const housing = Math.max(0, Math.min(p.monthlyIncome * ASSUME.frontEnd, p.monthlyIncome * ASSUME.backEnd - p.otherDebt));
  const byIncome = housing / per.monthly;
  const byCash = Math.max(0, p.cash) / (per.cashToClose + ASSUME.reserveMonths * per.monthly);
  const maxPrice = Math.max(0, Math.floor(Math.min(byIncome, byCash) / 1000) * 1000);
  return { maxPrice, byIncome, byCash, monthly: per.monthly * maxPrice };
}

// The loan's balance at the end of each year, and how each year's payments split.
export function amortization(principal: number, ratePct: number, years: number): { year: number; balance: number; interest: number; principal: number }[] {
  const pay = monthlyPayment(principal, ratePct, years);
  const r = ratePct / 100 / 12;
  let balance = principal;
  const out = [];
  for (let y = 1; y <= years; y++) {
    let interest = 0;
    let paid = 0;
    for (let m = 0; m < 12; m++) {
      const i = balance * r;
      const p = Math.min(balance, pay - i);
      interest += i;
      paid += p;
      balance -= p;
    }
    out.push({ year: y, balance: Math.max(0, balance), interest, principal: paid });
  }
  return out;
}

export function balanceAfter(principal: number, ratePct: number, years: number, monthsPaid: number): number {
  const pay = monthlyPayment(principal, ratePct, years);
  const r = ratePct / 100 / 12;
  let balance = principal;
  for (let m = 0; m < monthsPaid && balance > 0; m++) balance -= Math.min(balance, pay - balance * r);
  return Math.max(0, balance);
}

// Renting against buying the same home over the years: what each really costs once the owner's
// equity and the renter's invested down payment are counted.
export function rentVsBuy(o: { price: number; rent: number; downPct: number; ratePct: number; years: number; lon: number | null; horizon: number }): {
  rows: { year: number; buy: number; rent: number }[];
  breakEven: number | null;
} {
  const c = ownCost({ price: o.price, downPct: o.downPct, ratePct: o.ratePct, years: o.years, lon: o.lon });
  const rows = [];
  let breakEven: number | null = null;
  let paidOwn = c.cashToClose;
  let paidRent = 0;
  let rent = o.rent;
  let invested = c.cashToClose; // the renter keeps the down payment and closing money working
  for (let y = 1; y <= o.horizon; y++) {
    const value = o.price * Math.pow(1 + ASSUME.appreciation, y);
    const pmi = balanceAfter(c.loan, o.ratePct, o.years, (y - 1) * 12) / o.price > 0.8 ? c.pmi * 12 : 0;
    paidOwn += (c.principalInterest + c.tax + c.insurance) * 12 + pmi + o.price * ASSUME.maintenance;
    paidRent += rent * 12;
    rent *= 1 + ASSUME.rentGrowth;
    invested *= 1 + ASSUME.investReturn;
    const equity = value * (1 - ASSUME.selling) - balanceAfter(c.loan, o.ratePct, o.years, y * 12);
    const buy = paidOwn - equity;
    const rentNet = paidRent - (invested - c.cashToClose);
    rows.push({ year: y, buy, rent: rentNet });
    if (breakEven == null && buy < rentNet) breakEven = y;
  }
  return { rows, breakEven };
}

// What a home is worth from nearby homes for sale: their price per square foot, middle and spread.
export type Comp = { price: number; sqft: number; lat: number; lon: number };
export function valueFromComps(home: { sqft: number | null; lat: number; lon: number; price: number | null }, comps: Comp[]): { value: number; low: number; high: number; count: number } | null {
  if (!home.sqft) return null;
  const km = (c: Comp) => Math.hypot((c.lat - home.lat) * 111, (c.lon - home.lon) * 111 * Math.cos((home.lat * Math.PI) / 180));
  const near = comps.filter((c) => c.sqft > 300 && c.price > 20_000 && km(c) < 3 && Math.abs(c.sqft - home.sqft!) / home.sqft! < 0.5 && !(c.lat === home.lat && c.lon === home.lon));
  if (near.length < 3) return null;
  const per = near.map((c) => c.price / c.sqft).sort((a, b) => a - b);
  const at = (q: number) => per[Math.min(per.length - 1, Math.floor(q * per.length))];
  const round = (v: number) => Math.round(v / 1000) * 1000;
  return { value: round(at(0.5) * home.sqft), low: round(at(0.25) * home.sqft), high: round(at(0.75) * home.sqft), count: near.length };
}

// An owner's position: equity, what selling would leave, and how much a home-equity loan could add.
export function equity(value: number, owed: number, helocRatePct: number, borrow: number): { equity: number; netIfSold: number; helocRoom: number; borrowMonthly: number } {
  return {
    equity: value - owed,
    netIfSold: value * (1 - ASSUME.selling) - owed,
    helocRoom: Math.max(0, value * 0.8 - owed),
    borrowMonthly: monthlyPayment(borrow, helocRatePct, 10),
  };
}

// The cash moving in takes, item by item. Furniture and finishes are the design's, from stores;
// pieces scanned from your photos cost nothing here.
export function moveInCosts(o: { housing: { label: string; amount: number }[]; beds: number | null; furniture: number; finishes: number }): { label: string; amount: number }[] {
  const beds = Math.max(1, o.beds ?? 2);
  return [
    ...o.housing,
    { label: `Movers (local, ${beds} bedroom${beds > 1 ? 's' : ''})`, amount: 400 + 350 * beds },
    { label: 'Utility deposits and setup', amount: 150 },
    ...(o.furniture > 0 ? [{ label: 'Furniture for this design', amount: o.furniture }] : []),
    ...(o.finishes > 0 ? [{ label: 'Paint and flooring', amount: o.finishes }] : []),
  ].filter((l) => l.amount > 0);
}

export const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
export const pct = (n: number) => `${Math.round(n * 100)}%`;
