import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cacheDir } from "./cacheDir";
import {
  moveInBudget,
  type BankAccount,
  type BankBill,
  type BankTxn,
  type MoveInBudget,
} from "./budget";
import { categoryOf, splitMerchant, type BankTxnView } from "./bankSummary";
import type { Retailer } from "./types";

// Capital One Nessie v2 (the hackathon banking sandbox). Money is integer cents.
// Docs: https://v2.nessieisreal.com · API host is separate from the docs site.
const HOST = "https://v2-prod-api.nessieisreal.com";

export function nessieAvailable(): boolean {
  return !!process.env.NESSIE_API_KEY;
}

async function api<T = any>(
  method: "GET" | "POST",
  p: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(HOST + p, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.NESSIE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok)
    throw new Error(
      `Nessie ${method} ${p} ${res.status}: ${json?.detail ?? json?.title ?? text.slice(0, 200)}`,
    );
  return json as T;
}

// The demo mover: one customer with checking, savings and a credit card, a paycheck history,
// and the bills a renter has. Created once per API key and remembered on disk.
const DEMO = { first: "FurNiche AI", last: "Mover" };
type DemoIds = {
  customerId: string;
  checking: string;
  savings: string;
  card: string;
  merchants: Partial<Record<Retailer, string>>;
};
const idsFile = () => path.join(cacheDir("nessie"), "demo.json");

let cached: DemoIds | null = null;
let creating: Promise<DemoIds> | null = null;

async function readIds(): Promise<DemoIds | null> {
  try {
    return JSON.parse(await fs.readFile(idsFile(), "utf8")) as DemoIds;
  } catch {
    return null;
  }
}

async function writeIds(ids: DemoIds) {
  await fs.mkdir(path.dirname(idsFile()), { recursive: true });
  await fs.writeFile(idsFile(), JSON.stringify(ids, null, 2));
}

const RETAILER_MERCHANT: Record<Retailer, string> = {
  ikea: "IKEA Houston",
  amazon: "Amazon",
  wayfair: "Wayfair",
  "west-elm": "West Elm",
  target: "Target",
  other: "Home goods store",
};

async function createDemo(): Promise<DemoIds> {
  const customers = await api<{ items: any[] }>("GET", "/customers?limit=100");
  let customer = customers.items.find(
    (c) => c.first_name === DEMO.first && c.last_name === DEMO.last,
  );
  if (!customer) {
    customer = await api("POST", "/customers", {
      first_name: DEMO.first,
      last_name: DEMO.last,
      address: {
        street_number: "1400",
        street_name: "Westheimer Rd",
        city: "Houston",
        state: "TX",
        zip: "77006",
      },
    });
  }
  const existing = (
    await api<{ items: any[] }>("GET", `/customers/${customer.id}/accounts`)
  ).items;
  const find = (type: string) => existing.find((a) => a.type === type);
  const checking =
    find("Checking") ??
    (await api("POST", `/customers/${customer.id}/accounts`, {
      type: "Checking",
      nickname: "Everyday checking",
      balance_cents: 420_000,
    }));
  const savings =
    find("Savings") ??
    (await api("POST", `/customers/${customer.id}/accounts`, {
      type: "Savings",
      nickname: "Move-in savings",
      balance_cents: 650_000,
    }));
  const card =
    find("Credit Card") ??
    (await api("POST", `/customers/${customer.id}/accounts`, {
      type: "Credit Card",
      nickname: "Venture card",
      balance_cents: 0,
      credit_limit_cents: 500_000,
      rewards: 12_000,
    }));

  if (!existing.length) {
    // Two paychecks, so income can be read from the history, and the renter's monthly bills.
    for (const d of ["Payroll · Acme Health", "Payroll · Acme Health"])
      await api("POST", `/accounts/${checking.id}/deposits`, {
        amount_cents: 285_000,
        description: d,
      });
    const soon = (days: number) =>
      new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
    const bills: [string, number, number][] = [
      ["Rent", 1850, 5],
      ["CenterPoint Energy", 140, 12],
      ["Comcast Internet", 70, 18],
      ["Renters insurance", 22, 25],
    ];
    for (const [payee, amount, days] of bills) {
      await api("POST", `/accounts/${checking.id}/bills`, {
        status: "recurring",
        payee,
        nickname: payee,
        payment_amount: amount,
        payment_date: soon(days),
        recurring_date: Number(soon(days).slice(8, 10)),
      });
    }
  }

  const merchants: DemoIds["merchants"] = {};
  const known = (await api<{ items: any[] }>("GET", "/merchants?limit=100"))
    .items;
  for (const [r, name] of Object.entries(RETAILER_MERCHANT) as [
    Retailer,
    string,
  ][]) {
    merchants[r] =
      known.find((m) => m.name === name)?.id ??
      (await api("POST", "/merchants", { name, category: "Home furnishings" }))
        .id;
  }
  const ids: DemoIds = {
    customerId: customer.id,
    checking: checking.id,
    savings: savings.id,
    card: card.id,
    merchants,
  };
  await writeIds(ids);
  return ids;
}

async function demoIds(): Promise<DemoIds> {
  if (cached) return cached;
  cached = await readIds();
  if (cached) return cached;
  creating ??= createDemo().finally(() => (creating = null));
  cached = await creating;
  return cached;
}

const toAccount = (a: any): BankAccount => ({
  id: a.id,
  type: a.type,
  nickname: a.nickname,
  balance: (a.balance_cents ?? 0) / 100,
  available: (a.available_cents ?? a.balance_cents ?? 0) / 100,
  creditLimit: a.credit_limit_cents != null ? a.credit_limit_cents / 100 : null,
  rewards: a.rewards ?? 0,
});

export async function getBudget(planned: number): Promise<MoveInBudget> {
  const ids = await demoIds();
  const accounts = (
    await api<{ items: any[] }>("GET", `/customers/${ids.customerId}/accounts`)
  ).items.map(toAccount);
  const bills: BankBill[] = (
    await api<{ items: any[] }>("GET", `/accounts/${ids.checking}/bills`)
  ).items
    .filter((b) => b.status !== "cancelled" && b.status !== "completed")
    .map((b) => ({
      id: b.id,
      payee: b.payee,
      amount: Number(b.payment_amount) || 0,
      due: b.upcoming_payment_date ?? b.payment_date ?? null,
    }));
  const txns: BankTxn[] = (
    await api<{ items: any[] }>(
      "GET",
      `/accounts/${ids.checking}/transactions?limit=100`,
    )
  ).items.map((t) => ({
    id: t.id,
    kind: t.kind,
    amount: (t.amount_cents ?? 0) / 100,
    description: t.description ?? "",
    status: t.status,
    at: t.created_at,
  }));
  return moveInBudget({ accounts, bills, txns, planned, source: "nessie" });
}

export type CheckoutLine = {
  retailer: Retailer;
  amountUsd: number;
  description: string;
};

// One Nessie purchase per store, from the account the shopper picked.
export async function checkout(
  accountId: string,
  lines: CheckoutLine[],
): Promise<
  { id: string; retailer: Retailer; amountUsd: number; status: string }[]
> {
  const ids = await demoIds();
  if (![ids.checking, ids.savings, ids.card].includes(accountId))
    throw new Error("Unknown account");
  const out = [];
  for (const l of lines) {
    if (l.amountUsd <= 0) continue;
    const merchant = ids.merchants[l.retailer] ?? ids.merchants.other!;
    const t = await api("POST", `/accounts/${accountId}/purchases`, {
      merchant_id: merchant,
      amount_cents: Math.round(l.amountUsd * 100),
      description: l.description.slice(0, 200),
    });
    out.push({
      id: t.id,
      retailer: l.retailer,
      amountUsd: l.amountUsd,
      status: t.status ?? "pending",
    });
  }
  return out;
}

// Every transaction on the mover's accounts, for the banking dashboard. Deposits are money in;
// purchases, withdrawals and bill payments are money out.
export async function getBankTransactions(accounts: BankAccount[]): Promise<BankTxnView[]> {
  const out: BankTxnView[] = [];
  for (const a of accounts) {
    const items = await api<{ items: any[] }>("GET", `/accounts/${a.id}/transactions?limit=100`)
      .then((r) => r.items)
      .catch(() => [] as any[]);
    for (const t of items) {
      const text = String(t.description || t.merchant_name || t.kind || "Transaction");
      const { merchant, note } = splitMerchant(text);
      out.push({
        id: String(t.id),
        accountId: a.id,
        account: a.nickname,
        direction: t.kind === "deposit" ? "in" : "out",
        amount: Math.abs((t.amount_cents ?? 0) / 100),
        merchant: merchant.slice(0, 80),
        note: note?.slice(0, 160),
        category: categoryOf(text),
        at: t.created_at ?? new Date().toISOString(),
        status: t.status ?? "completed",
      });
    }
  }
  return out;
}
