'use client';
import { create } from 'zustand';

// Live IKEA prices for the pieces in the design, fetched once per product per session from
// /api/ikea-prices (which reads ikea.com and caches for 30 minutes).
export type LivePrice = { price: number; currency: string; inStock: boolean | null; url: string; checkedAt: string };

type S = { prices: Record<string, LivePrice | null>; asked: Set<string>; want: (ids: string[]) => void; show: boolean; setShow: (on: boolean) => void };

export const useLivePrices = create<S>((set, get) => ({
  prices: {},
  asked: new Set(),
  show: true, // price tags over the pieces in the tour
  setShow: (show) => set({ show }),
  want: (ids) => {
    const fresh = ids.filter((id) => !get().asked.has(id));
    if (!fresh.length) return;
    fresh.forEach((id) => get().asked.add(id));
    fetch('/api/ikea-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: fresh }) })
      .then((r) => r.json())
      .then((j: { prices?: Record<string, LivePrice | null> }) => set({ prices: { ...get().prices, ...(j.prices ?? {}) } }))
      .catch(() => fresh.forEach((id) => get().asked.delete(id))); // try again later
  },
}));
