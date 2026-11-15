'use client';
import { useEffect, useState } from 'react';
import type { FinanceProfile, Rates } from '@/lib/homeFinance';
import type { HomeLoan } from '@/lib/nessie';

// The mover's money and this week's rates (app/api/finance), shared by the listings' affordability
// badges and the finance page, and read again after half a minute so a checkout elsewhere shows.
export type FinanceData = { profile: FinanceProfile; rates: Rates; loans: HomeLoan[]; source: 'nessie' | 'demo'; error?: string };

let shared: { at: number; data: Promise<FinanceData | null> } | null = null;
const load = () => {
  if (!shared || Date.now() - shared.at > 30_000)
    shared = {
      at: Date.now(),
      data: fetch('/api/finance')
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    };
  return shared.data;
};

export function useFinance(): [FinanceData | null, () => void] {
  const [data, setData] = useState<FinanceData | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [version]);
  const refresh = () => {
    shared = null;
    setVersion((v) => v + 1);
  };
  return [data, refresh];
}
