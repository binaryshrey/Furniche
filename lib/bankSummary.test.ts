import { describe, expect, it } from "vitest";
import { demoBudget } from "./budget";
import { categoryOf, healthScore, sampleActivity, splitMerchant, summarize, type BankTxnView } from "./bankSummary";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const budget = demoBudget(0);

describe("categoryOf", () => {
  it("sorts merchants into categories", () => {
    expect(categoryOf("Payroll · Acme Health")).toBe("Income");
    expect(categoryOf("Rent")).toBe("Housing");
    expect(categoryOf("CenterPoint Energy")).toBe("Utilities");
    expect(categoryOf("Renters insurance")).toBe("Insurance");
    expect(categoryOf("IKEA Houston")).toBe("Furnishing");
    expect(categoryOf("Starbucks Coffee")).toBe("Food & Drinks");
    expect(categoryOf("Uber Ride")).toBe("Transport");
    expect(categoryOf("Netflix")).toBe("Subscriptions");
    expect(categoryOf("Mystery shop")).toBe("Other");
  });
});

describe("sampleActivity", () => {
  it("is reproducible, flagged as sample and never in the future", () => {
    const a = sampleActivity(budget.accounts, budget.bills, [], NOW);
    expect(a.length).toBeGreaterThan(40);
    expect(a.every((t) => t.sample)).toBe(true);
    expect(a.every((t) => Date.parse(t.at) <= NOW)).toBe(true);
    expect(sampleActivity(budget.accounts, budget.bills, [], NOW).map((t) => t.id)).toEqual(a.map((t) => t.id));
  });
  it("adds paychecks only when the account shows no recent income", () => {
    const pay = (r: BankTxnView[]) => sampleActivity(budget.accounts, budget.bills, r, NOW).filter((t) => t.direction === "in").length;
    expect(pay([])).toBeGreaterThan(0);
    const real: BankTxnView = { id: "r", accountId: "demo-checking", account: "x", direction: "in", amount: 2850, merchant: "Payroll", category: "Income", at: new Date(NOW - 5 * 864e5).toISOString(), status: "completed" };
    expect(pay([real])).toBe(0);
  });
});

describe("summarize", () => {
  const txns = sampleActivity(budget.accounts, budget.bills, [], NOW);
  const s = summarize(txns, NOW);
  it("splits the month into spent and saved that add up", () => {
    expect(s.spentPct + s.savedPct).toBeGreaterThanOrEqual(99);
    expect(s.spentPct + s.savedPct).toBeLessThanOrEqual(101);
    expect(s.income).toBeGreaterThan(0);
    expect(s.hasSample).toBe(true);
  });
  it("gives eight weeks and categories that sum to one", () => {
    expect(s.weekly).toHaveLength(8);
    expect(s.byCategory.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1, 5);
  });
  it("ignores declined payments", () => {
    const one: BankTxnView = { id: "x", accountId: "a", account: "a", direction: "out", amount: 500, merchant: "Rent", category: "Housing", at: new Date(NOW - 864e5).toISOString(), status: "declined" };
    expect(summarize([one], NOW).spent).toBe(0);
  });
});

describe("healthScore", () => {
  it("scores between 0 and 100 with a label and tips", () => {
    const s = summarize(sampleActivity(budget.accounts, budget.bills, [], NOW), NOW);
    const h = healthScore({ accounts: budget.accounts, budget }, s);
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(h.parts.reduce((a, p) => a + p.points, 0)).toBe(h.score);
    expect(h.label.length).toBeGreaterThan(3);
    expect(h.tips.length).toBeGreaterThan(0);
  });
  it("penalises a maxed-out card", () => {
    const s = summarize([], NOW);
    const ok = healthScore({ accounts: budget.accounts, budget }, s).score;
    const maxed = budget.accounts.map((a) => (a.type === "Credit Card" ? { ...a, balance: a.creditLimit ?? 0 } : a));
    expect(healthScore({ accounts: maxed, budget }, s).score).toBeLessThan(ok);
  });
});

describe("splitMerchant", () => {
  it("shows a checkout as an order with its items as the note", () => {
    expect(splitMerchant("FurNiche AI: 2x Artificial fiddle leaf fig tree, 1x LACK")).toEqual({ merchant: "FurNiche AI order", note: "2x Artificial fiddle leaf fig tree, 1x LACK" });
    expect(splitMerchant("Furniche: paint and flooring")).toEqual({ merchant: "FurNiche AI order", note: "paint and flooring" });
    expect(splitMerchant("Starbucks Coffee")).toEqual({ merchant: "Starbucks Coffee" });
  });
});
