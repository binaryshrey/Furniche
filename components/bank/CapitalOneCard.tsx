import CapitalOneLogo from "@/components/ui/CapitalOneLogo";
import type { BankAccount } from "@/lib/budget";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// What an account can pay with right now: cash available, or credit left on a card.
export const spendable = (a: BankAccount) => (a.type === "Credit Card" ? (a.creditLimit ?? 0) - a.balance : a.available);

// A masked number for the card art, made from the account id (sandbox accounts have no real one).
export const last4 = (id: string) => String([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 10000, 7)).padStart(4, "0");

const SKIN: Record<BankAccount["type"], string> = {
  Checking: "from-[#0a3a63] via-[#004977] to-[#0b2540]",
  Savings: "from-[#0b4a52] via-[#0a6670] to-[#0b2f3a]",
  "Credit Card": "from-[#1b1b22] via-[#2d2d38] to-[#101015]",
};

// A Capital One card for one of the mover's sandbox accounts. No real card number is shown.
export default function CapitalOneCard({ account, className = "" }: { account: BankAccount; className?: string }) {
  return (
    <div className={`relative aspect-[1.7/1] w-full overflow-hidden rounded-2xl bg-gradient-to-br ${SKIN[account.type]} p-5 text-white shadow-xl ring-1 ring-white/10 ${className}`}>
      <div className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
      <div className="flex items-start justify-between">
        <CapitalOneLogo className="h-7 w-auto text-white" />
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">Sandbox</span>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <div className="h-8 w-11 rounded-md bg-gradient-to-br from-[#e9d9a6] to-[#b89a4a]" aria-hidden />
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeOpacity=".7" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <path d="M8 7a7 7 0 0 1 0 10M12 5a11 11 0 0 1 0 14M16 3a15 15 0 0 1 0 18" />
        </svg>
      </div>
      <div className="num mt-4 text-lg tracking-[0.2em]">•••• •••• •••• {last4(account.id)}</div>
      <div className="mt-3 flex items-end justify-between text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/60">{account.type}</div>
          <div className="font-medium">{account.nickname}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/60">{account.type === "Credit Card" ? "Credit left" : "Available"}</div>
          <div className="num font-medium">{usd(spendable(account))}</div>
        </div>
      </div>
    </div>
  );
}
