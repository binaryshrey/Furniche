// Move-in budget: how much of a furnishing plan the mover can pay for without missing a bill.
// Pure functions, fed by Capital One Nessie accounts (lib/nessie.ts) or the demo below.

export type BankAccount = {
  id: string;
  type: 'Checking' | 'Savings' | 'Credit Card';
  nickname: string;
  balance: number; // USD; for a card, the amount owed
  available: number;
  creditLimit: number | null;
  rewards: number;
};
export type BankBill = { id: string; payee: string; amount: number; due: string | null };
export type BankTxn = { id: string; kind: string; amount: number; description: string; status: string; at: string };

export type MoveInBudget = {
  source: 'nessie' | 'demo';
  accounts: BankAccount[];
  bills: BankBill[];
  monthlyIncome: number;
  monthlyBills: number;
  rent: number | null;
  rentShare: number | null; // rent / income
  cashFree: number; // checking left after this month's bills and a cushion
  savingsShare: number; // part of savings it is reasonable to put toward the move
  cardRoom: number; // card spend that keeps utilisation under 30%
  safeToSpend: number; // cashFree + savingsShare
  planned: number; // the design's furniture + finishes total
  status: 'comfortable' | 'stretch' | 'over';
  plan: { label: string; amount: number; from: string }[];
  notes: string[];
};

export const RULES = {
  cushion: 500, // keep in checking after bills
  savingsShare: 0.4, // share of savings toward move-in
  cardUtilisation: 0.3,
  rentShareMax: 0.3,
};

const round = (n: number) => Math.round(n * 100) / 100;

export function moveInBudget(opts: { accounts: BankAccount[]; bills: BankBill[]; txns: BankTxn[]; planned: number; source: MoveInBudget['source'] }): MoveInBudget {
  const { accounts, bills, txns, planned, source } = opts;
  const checking = accounts.filter((a) => a.type === 'Checking');
  const savings = accounts.filter((a) => a.type === 'Savings');
  const cards = accounts.filter((a) => a.type === 'Credit Card');

  const monthAgo = Date.now() - 31 * 864e5;
  const deposits = txns.filter((t) => t.kind === 'deposit' && t.status !== 'declined' && t.status !== 'cancelled');
  const recent = deposits.filter((t) => Date.parse(t.at) >= monthAgo);
  const monthlyIncome = round((recent.length ? recent : deposits).reduce((s, t) => s + t.amount, 0));
  const monthlyBills = round(bills.reduce((s, b) => s + b.amount, 0));
  const rentBill = bills.find((b) => /rent|mortgage/i.test(b.payee));
  const rent = rentBill?.amount ?? null;

  const cash = checking.reduce((s, a) => s + a.available, 0);
  const cashFree = round(Math.max(0, cash - monthlyBills - RULES.cushion));
  const savingsShare = round(savings.reduce((s, a) => s + a.available, 0) * RULES.savingsShare);
  const cardRoom = round(cards.reduce((s, a) => s + Math.max(0, (a.creditLimit ?? 0) * RULES.cardUtilisation - a.balance), 0));
  const safeToSpend = round(cashFree + savingsShare);
  const surplus = Math.max(0, monthlyIncome - monthlyBills);

  const status: MoveInBudget['status'] = planned <= safeToSpend ? 'comfortable' : planned <= safeToSpend + cardRoom ? 'stretch' : 'over';

  // Pay from cash first, then savings, then the card up to 30%, then wait for paychecks.
  const plan: MoveInBudget['plan'] = [];
  let left = planned;
  const take = (label: string, cap: number, from: string) => {
    const amt = round(Math.min(left, cap));
    if (amt > 0) plan.push({ label, amount: amt, from });
    left = round(left - amt);
  };
  take('Now, from checking', cashFree, checking[0]?.nickname ?? 'Checking');
  take('Now, from move-in savings', savingsShare, savings[0]?.nickname ?? 'Savings');
  take('Now, on the card (stays under 30% used)', cardRoom, cards[0]?.nickname ?? 'Credit card');
  for (let m = 1; left > 0 && surplus > 0 && m <= 12; m++) take(`After paycheck month ${m}`, surplus, checking[0]?.nickname ?? 'Checking');
  if (left > 0) plan.push({ label: 'Not covered within a year', amount: left, from: '-' });

  const notes: string[] = [];
  const rentShare = rent && monthlyIncome ? round(rent / monthlyIncome) : null;
  if (rentShare != null) {
    notes.push(
      rentShare > RULES.rentShareMax
        ? `Rent is ${Math.round(rentShare * 100)}% of income, above the 30% guideline; keep the furniture budget lean.`
        : `Rent is ${Math.round(rentShare * 100)}% of income, within the 30% guideline.`,
    );
  }
  if (status === 'stretch') notes.push('The plan needs the credit card. Pay the card off in full to avoid interest.');
  if (status === 'over') notes.push(`The plan is $${Math.round(planned - safeToSpend - cardRoom).toLocaleString()} over what you can cover now; buy the essentials first.`);
  return { source, accounts, bills, monthlyIncome, monthlyBills, rent, rentShare, cashFree, savingsShare, cardRoom, safeToSpend, planned: round(planned), status, plan, notes };
}

// Used when no Nessie key is set, so the feature still demos. Same shape as the seeded Nessie customer.
export function demoBudget(planned: number): MoveInBudget {
  const now = new Date().toISOString();
  return moveInBudget({
    source: 'demo',
    planned,
    accounts: [
      { id: 'demo-checking', type: 'Checking', nickname: 'Everyday checking', balance: 4200, available: 4200, creditLimit: null, rewards: 0 },
      { id: 'demo-savings', type: 'Savings', nickname: 'Move-in savings', balance: 6500, available: 6500, creditLimit: null, rewards: 0 },
      { id: 'demo-card', type: 'Credit Card', nickname: 'Venture card', balance: 0, available: 5000, creditLimit: 5000, rewards: 12000 },
    ],
    bills: [
      { id: 'b1', payee: 'Rent', amount: 1850, due: null },
      { id: 'b2', payee: 'CenterPoint Energy', amount: 140, due: null },
      { id: 'b3', payee: 'Comcast Internet', amount: 70, due: null },
      { id: 'b4', payee: 'Renters insurance', amount: 22, due: null },
    ],
    txns: [
      { id: 't1', kind: 'deposit', amount: 2850, description: 'Payroll', status: 'completed', at: now },
      { id: 't2', kind: 'deposit', amount: 2850, description: 'Payroll', status: 'completed', at: now },
    ],
  });
}
