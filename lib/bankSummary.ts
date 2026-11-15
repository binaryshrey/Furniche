import type { BankAccount, BankBill, MoveInBudget } from "./budget";

// What the banking dashboard shows, worked out from the mover's Capital One accounts (Nessie
// sandbox, or the demo customer): categories, a month's saving vs spending, spending by week and
// a financial health score. Pure functions, so they are tested without a browser.

export type Category = "Income" | "Housing" | "Utilities" | "Insurance" | "Furnishing" | "Food & Drinks" | "Transport" | "Subscriptions" | "Other";

export type BankTxnView = {
  id: string;
  accountId: string;
  account: string; // the account's nickname
  direction: "in" | "out";
  amount: number; // always positive, dollars
  merchant: string;
  note?: string; // detail line, e.g. the items in an order
  category: Category;
  at: string; // ISO time
  status: string;
  sample?: boolean; // generated activity, not from the accounts
};

export type BankData = {
  source: "nessie" | "demo";
  holder: string;
  accounts: BankAccount[];
  bills: BankBill[];
  transactions: BankTxnView[];
  budget: MoveInBudget;
};

const RULES: [RegExp, Category][] = [
  [/payroll|salary|paycheck|direct deposit|freelance/i, "Income"],
  [/\brent\b|mortgage|landlord/i, "Housing"],
  [/energy|electric|water|utilit|comcast|internet|wifi|phone|verizon|at&t/i, "Utilities"],
  [/insurance/i, "Insurance"],
  [/ikea|amazon|wayfair|west elm|target|furniche|home goods|furnish|paint|flooring/i, "Furnishing"],
  [/starbucks|coffee|cafe|restaurant|doordash|grubhub|pizza|taco|burger|grocer|h-e-b|\bheb\b|kroger|whole foods|trader joe/i, "Food & Drinks"],
  [/uber|lyft|metro|transit|shell|chevron|exxon|fuel|parking/i, "Transport"],
  [/spotify|netflix|hulu|disney|subscription|icloud|youtube/i, "Subscriptions"],
];

// A checkout posts its whole shopping list as the description ("FurNiche AI: 2x A, 1x B"): show it as an
// order, with the items as the detail line.
export function splitMerchant(description: string): { merchant: string; note?: string } {
  const m = description.match(/^furniche(?: ai)?:\s*(.+)$/i);
  return m ? { merchant: "FurNiche AI order", note: m[1] } : { merchant: description };
}

export function categoryOf(text: string): Category {
  return RULES.find(([re]) => re.test(text))?.[1] ?? "Other";
}

// A reproducible 0..1 number from a text seed, so the sample history is the same on every load.
function rnd(seed: string): number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

const DAY = 864e5;

// About two months of everyday activity for the checking account and the card, plus the monthly
// bills as they would have posted. Every row is flagged `sample`: it is not from the accounts.
export function sampleActivity(accounts: BankAccount[], bills: BankBill[], real: BankTxnView[] = [], now = Date.now()): BankTxnView[] {
  const checking = accounts.find((a) => a.type === "Checking");
  const card = accounts.find((a) => a.type === "Credit Card");
  if (!checking) return [];
  const out: BankTxnView[] = [];
  const add = (key: string, acct: BankAccount, merchant: string, amount: number, daysAgo: number, hour = 12, direction: "in" | "out" = "out") => {
    const at = new Date(now - daysAgo * DAY);
    at.setHours(hour, Math.floor(rnd(key + "m") * 59), 0, 0);
    if (at.getTime() > now) return;
    out.push({ id: `sample-${key}`, accountId: acct.id, account: acct.nickname, direction, amount: Math.round(amount * 100) / 100, merchant, category: categoryOf(merchant), at: at.toISOString(), status: "completed", sample: true });
  };
  const habits: [string, string, number, number][] = [
    // merchant, what it is, how often (per week), typical amount
    ["Starbucks Coffee", "coffee", 3, 5.4],
    ["H-E-B Grocery", "grocery", 2, 74],
    ["Uber Ride", "ride", 1.5, 17],
    ["Chipotle", "lunch", 1.5, 13],
    ["Shell Gas Station", "fuel", 0.7, 42],
  ];
  for (let d = 0; d < 62; d++) {
    for (const [merchant, kind, perWeek, typical] of habits) {
      const key = `${kind}-${d}`;
      if (rnd(key) < perWeek / 7) add(key, kind === "grocery" || kind === "fuel" ? checking : (card ?? checking), merchant, typical * (0.6 + rnd(key + "a") * 0.9), d, 8 + Math.floor(rnd(key + "h") * 11));
    }
  }
  // Streaming and music on the card, monthly.
  for (const [merchant, amount, day] of [["Spotify", 11.99, 9], ["Netflix", 15.49, 21]] as const) for (let m = 0; m < 3; m++) add(`sub-${merchant}-${m}`, card ?? checking, merchant, amount, day + m * 30, 6);
  // The bills, one posting a month.
  for (const b of bills) for (let m = 0; m < 2; m++) add(`bill-${b.id}-${m}`, checking, b.payee, b.amount, 3 + m * 30 + Math.floor(rnd(b.id) * 20), 9);
  // Paychecks on the 1st and 15th, unless the account already shows income this past month.
  const realIncome = real.some((t) => t.direction === "in" && t.category === "Income" && Date.parse(t.at) >= now - 35 * DAY);
  if (!realIncome) {
    for (let d = 0; d < 62; d++) {
      const day = new Date(now - d * DAY).getDate();
      if (day === 1 || day === 15) add(`pay-${d}`, checking, "Payroll · Acme Health", 2850, d, 8, "in");
    }
  }
  return out;
}

export type Summary = {
  income: number;
  spent: number;
  saved: number;
  spentPct: number;
  savedPct: number;
  byCategory: { category: Category; amount: number; share: number }[];
  weekly: { label: string; amount: number }[];
  topMerchants: { merchant: string; amount: number; count: number }[];
  monthName: string;
  hasSample: boolean;
};

const monthKey = (iso: string) => iso.slice(0, 7);

export function summarize(txns: BankTxnView[], now = Date.now()): Summary {
  const nowD = new Date(now);
  const thisMonth = nowD.toISOString().slice(0, 7);
  const live = txns.filter((t) => t.status !== "declined" && t.status !== "cancelled");
  const month = live.filter((t) => monthKey(t.at) === thisMonth);
  const income = month.filter((t) => t.direction === "in" && t.category === "Income").reduce((s, t) => s + t.amount, 0);
  const spending = month.filter((t) => t.direction === "out");
  const spent = spending.reduce((s, t) => s + t.amount, 0);
  const saved = Math.max(0, income - spent);
  const total = spent + saved || 1;

  const cats = new Map<Category, number>();
  for (const t of live.filter((x) => x.direction === "out" && Date.parse(x.at) >= now - 30 * DAY)) cats.set(t.category, (cats.get(t.category) ?? 0) + t.amount);
  const catTotal = [...cats.values()].reduce((s, v) => s + v, 0) || 1;
  const byCategory = [...cats.entries()].map(([category, amount]) => ({ category, amount, share: amount / catTotal })).sort((a, b) => b.amount - a.amount);

  // Eight weeks, oldest first.
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const end = now - (7 - i) * 7 * DAY + 7 * DAY;
    const start = end - 7 * DAY;
    const amount = live.filter((t) => t.direction === "out" && Date.parse(t.at) >= start && Date.parse(t.at) < end).reduce((s, t) => s + t.amount, 0);
    const d = new Date(start);
    return { label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), amount };
  });

  const merchants = new Map<string, { amount: number; count: number }>();
  for (const t of live.filter((x) => x.direction === "out" && Date.parse(x.at) >= now - 30 * DAY)) {
    const m = merchants.get(t.merchant) ?? { amount: 0, count: 0 };
    merchants.set(t.merchant, { amount: m.amount + t.amount, count: m.count + 1 });
  }
  const topMerchants = [...merchants.entries()].map(([merchant, v]) => ({ merchant, ...v })).sort((a, b) => b.amount - a.amount).slice(0, 5);

  return {
    income,
    spent,
    saved,
    spentPct: Math.round((spent / total) * 100),
    savedPct: Math.round((saved / total) * 100),
    byCategory,
    weekly,
    topMerchants,
    monthName: nowD.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    hasSample: txns.some((t) => t.sample),
  };
}

export type Health = { score: number; label: string; parts: { name: string; points: number; max: number; note: string }[]; tips: string[] };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// 0-100 from four habits: saving, rent share, card use and an emergency fund.
export function healthScore(data: Pick<BankData, "accounts" | "budget">, summary: Summary): Health {
  const { accounts, budget } = data;
  const cards = accounts.filter((a) => a.type === "Credit Card");
  const limit = cards.reduce((s, a) => s + (a.creditLimit ?? 0), 0);
  const owed = cards.reduce((s, a) => s + a.balance, 0);
  const utilisation = limit ? owed / limit : 0;
  const cash = accounts.filter((a) => a.type !== "Credit Card").reduce((s, a) => s + a.balance, 0);
  const monthlyOut = Math.max(budget.monthlyBills, summary.spent) || 1;
  const months = cash / monthlyOut;
  const rate = summary.income ? (summary.income - summary.spent) / summary.income : budget.monthlyIncome ? (budget.monthlyIncome - budget.monthlyBills) / budget.monthlyIncome : 0;

  const parts = [
    { name: "Saving", max: 30, points: Math.round(clamp01(rate / 0.2) * 30), note: `${Math.round(Math.max(0, rate) * 100)}% of income kept (goal 20%)` },
    { name: "Rent share", max: 20, points: budget.rentShare == null ? 20 : Math.round(clamp01(1 - (budget.rentShare - 0.3) / 0.2) * 20), note: budget.rentShare == null ? "No rent on file" : `${Math.round(budget.rentShare * 100)}% of income (goal under 30%)` },
    { name: "Card use", max: 20, points: Math.round(clamp01(1 - (utilisation - 0.3) / 0.4) * 20), note: `${Math.round(utilisation * 100)}% of the limit used (goal under 30%)` },
    { name: "Emergency fund", max: 30, points: Math.round(clamp01(months / 3) * 30), note: `${months.toFixed(1)} months of spending covered (goal 3+)` },
  ];
  const score = parts.reduce((s, p) => s + p.points, 0);
  const label = score >= 80 ? "Excellent" : score >= 65 ? "Good, but could be better" : score >= 50 ? "Fair, with room to improve" : "Needs attention";

  const tips: string[] = [];
  if (utilisation > 0.3) tips.push("Pay down your card: using under 30% of the limit helps your score.");
  if (rate < 0.2) tips.push("Aim to spend less on non-essentials and keep 20% of your income.");
  if (months < 3) tips.push("Build an emergency fund covering 3+ months of spending.");
  if (budget.rentShare != null && budget.rentShare > 0.3) tips.push("Rent is over 30% of income, so keep the furniture budget lean.");
  const top = summary.byCategory.find((c) => !["Housing", "Utilities", "Insurance"].includes(c.category));
  if (top) tips.push(`${top.category} is your biggest flexible spend this month (${Math.round(top.share * 100)}% of spending).`);
  if (!tips.length) tips.push("You're on track: keep paying bills on time and saving each month.");
  return { score, label, parts, tips: tips.slice(0, 4) };
}

export const money = (n: number, cents = true) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
