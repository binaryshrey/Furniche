import { NextResponse } from 'next/server';
import { sampleActivity, type BankData, type BankTxnView } from '@/lib/bankSummary';
import { getBankTransactions, loadBudget } from '@/lib/nessie';

// GET /api/bank → the mover's Capital One accounts, bills and transactions for the dashboard:
// live from the Nessie sandbox when NESSIE_API_KEY is set, else the demo customer. Because the
// sandbox customer has little history, a clearly flagged `sample` activity fills the last two months.
export async function GET() {
  const budget = await loadBudget(0);
  const real: BankTxnView[] = budget.source === 'nessie' ? await getBankTransactions().catch(() => []) : [];
  const transactions = [...real, ...sampleActivity(budget.accounts, budget.bills, real)].sort((a, b) => b.at.localeCompare(a.at));
  const data: BankData & { error?: string } = { source: budget.source, holder: 'FurNiche AI Mover', accounts: budget.accounts, bills: budget.bills, transactions, budget, error: budget.error };
  return NextResponse.json(data);
}
