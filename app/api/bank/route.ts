import { NextResponse } from 'next/server';
import { sampleActivity, type BankData, type BankTxnView } from '@/lib/bankSummary';
import { demoBudget, type MoveInBudget } from '@/lib/budget';
import { getBankTransactions, getBudget, nessieAvailable } from '@/lib/nessie';

// GET /api/bank → the mover's Capital One accounts, bills and transactions for the dashboard:
// live from the Nessie sandbox when NESSIE_API_KEY is set, else the demo customer. Because the
// sandbox customer has little history, a clearly flagged `sample` activity fills the last two months.
export async function GET() {
  let budget: MoveInBudget;
  let real: BankTxnView[] = [];
  let source: BankData['source'] = 'demo';
  let error: string | undefined;
  if (nessieAvailable()) {
    try {
      budget = await getBudget(0);
      real = await getBankTransactions(budget.accounts);
      source = 'nessie';
    } catch (e) {
      console.error('[nessie]', (e as Error).message);
      budget = demoBudget(0);
      error = 'Capital One sandbox unavailable; showing demo data.';
    }
  } else {
    budget = demoBudget(0);
  }
  const transactions = [...real, ...sampleActivity(budget.accounts, budget.bills, real)].sort((a, b) => b.at.localeCompare(a.at));
  const data: BankData & { error?: string } = { source, holder: 'FurNiche AI Mover', accounts: budget.accounts, bills: budget.bills, transactions, budget, error };
  return NextResponse.json(data);
}
