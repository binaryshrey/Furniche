import type { Category, Summary } from "@/lib/bankSummary";
import { money } from "@/lib/bankSummary";

export const CATEGORY_COLOR: Record<Category, string> = {
  Income: "#5ad19a",
  Housing: "#7aa2ff",
  Utilities: "#62c4c4",
  Insurance: "#a58bff",
  Furnishing: "#fc7249",
  "Food & Drinks": "#ffc857",
  Transport: "#4fb3ff",
  Subscriptions: "#f27ab6",
  Other: "#8d8f94",
};

const ICON: Record<Category, string> = {
  Income: "M12 4v12m0 0l-4-4m4 4l4-4M5 20h14",
  Housing: "M4 11l8-7 8 7v9H4zM10 20v-6h4v6",
  Utilities: "M13 3L5 14h6l-1 7 8-11h-6z",
  Insurance: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z",
  Furnishing: "M4 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M3 12h18v4H3zM5 16v2M19 16v2",
  "Food & Drinks": "M6 3v7a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6 0 8v10",
  Transport: "M5 16l1.5-6h11L19 16M4 16h16v3H4zM7 19v2M17 19v2",
  Subscriptions: "M5 5h14v14H5zM10 9l5 3-5 3z",
  Other: "M4 4h8l8 8-8 8-8-8z",
};

export function CategoryIcon({ category, size = 40 }: { category: Category; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, background: `${CATEGORY_COLOR[category]}22`, color: CATEGORY_COLOR[category] }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={ICON[category]} />
      </svg>
    </span>
  );
}

// Spent vs saved this month as a ring.
export function Donut({ spent, saved, centre }: { spent: number; saved: number; centre: string }) {
  const R = 78;
  const C = 2 * Math.PI * R;
  const total = spent + saved || 1;
  const spentLen = (spent / total) * C;
  const GAP = spent && saved ? 6 : 0;
  return (
    <svg viewBox="0 0 200 200" className="h-48 w-48" role="img" aria-label={`Spent ${money(spent, false)}, saved ${money(saved, false)}`}>
      <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" strokeOpacity=".08" strokeWidth="22" />
      <circle cx="100" cy="100" r={R} fill="none" stroke="#7aa2ff" strokeWidth="22" strokeLinecap={saved ? "round" : "butt"} strokeDasharray={saved ? `${Math.max(0, spentLen - GAP)} ${C}` : `${C} ${C}`} transform="rotate(-90 100 100)" />
      {saved > 0 && <circle cx="100" cy="100" r={R} fill="none" stroke="#5ad19a" strokeWidth="22" strokeLinecap="round" strokeDasharray={`${Math.max(0, C - spentLen - GAP)} ${C}`} strokeDashoffset={-(spentLen + GAP / 2)} transform="rotate(-90 100 100)" />}
      <text x="100" y="92" textAnchor="middle" className="fill-current text-[11px]" fillOpacity=".6">
        Income
      </text>
      <text x="100" y="116" textAnchor="middle" className="fill-current text-[22px] font-semibold">
        {centre}
      </text>
    </svg>
  );
}

// A half-circle gauge, 0-100.
export function Gauge({ score, label }: { score: number; label: string }) {
  const L = Math.PI * 80;
  const color = score >= 80 ? "#5ad19a" : score >= 65 ? "#a58bff" : score >= 50 ? "#ffc857" : "#ff6b5e";
  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <svg viewBox="0 0 200 118" className="w-full" role="img" aria-label={`Financial health score ${score} out of 100`}>
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="currentColor" strokeOpacity=".1" strokeWidth="16" strokeLinecap="round" />
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(score / 100) * L} ${L}`} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="font-display text-5xl font-semibold leading-none">
          {score}
          <span className="text-lg font-normal text-muted">/100</span>
        </div>
        <div className="mt-1 text-sm text-muted">{label}</div>
      </div>
    </div>
  );
}

// Spending per week for the last eight weeks.
export function WeeklyBars({ weekly }: { weekly: Summary["weekly"] }) {
  const max = Math.max(...weekly.map((w) => w.amount), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-2" role="img" aria-label="Spending per week for the last eight weeks">
        {weekly.map((w, i) => (
          <div key={w.label} className="group flex h-full flex-1 flex-col items-center justify-end">
            <span className="num mb-1 text-[10px] text-muted opacity-0 transition group-hover:opacity-100">{money(w.amount, false)}</span>
            <div className="w-full rounded-t-md transition group-hover:opacity-100" style={{ height: `${Math.max(3, (w.amount / max) * 100)}%`, background: i === weekly.length - 1 ? "#fc7249" : "#7aa2ff", opacity: i === weekly.length - 1 ? 1 : 0.7 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {weekly.map((w) => (
          <span key={w.label} className="flex-1 text-center text-[10px] text-muted">
            {w.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// Where the last 30 days of spending went.
export function CategoryBars({ rows }: { rows: Summary["byCategory"] }) {
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.category}>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLOR[r.category] }} />
              {r.category}
            </span>
            <span className="num text-muted">
              {money(r.amount, false)} · {Math.round(r.share * 100)}%
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.share * 100)}%`, background: CATEGORY_COLOR[r.category] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
