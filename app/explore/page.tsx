'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { TopNav } from '@/components/ui/Brand';
import { fmtUsd } from '@/components/shop/ShopPanel';
import type { Listing } from '@/lib/types';

type Data = { homes: Listing[]; apartments: Listing[]; error?: string };

export default function Explore() {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<'homes' | 'apartments'>('homes');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(36);

  useEffect(() => {
    fetch('/api/listings')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ homes: [], apartments: [], error: 'Could not load listings.' }));
  }, []);

  const list = useMemo(() => {
    const rows = data?.[tab] ?? [];
    const f = q.toLowerCase();
    return rows.filter((l) => !f || JSON.stringify(l).toLowerCase().includes(f));
  }, [data, tab, q]);

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Houston</p>
            <h1 className="font-display text-4xl">Pick a home to furnish</h1>
            <p className="mt-1 text-sm text-muted">Every home here has a 3D scan with an empty-room view.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-line bg-card text-sm">
              {(['homes', 'apartments'] as const).map((t) => (
                <button key={t} onClick={() => (setTab(t), setLimit(36))} className={`px-4 py-2 ${tab === t ? 'bg-ink text-paper' : ''}`}>
                  {t === 'homes' ? `Homes (${data?.homes.length ?? '…'})` : `Apartments (${data?.apartments.length ?? '…'})`}
                </button>
              ))}
            </div>
            <input id="explore-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or neighbourhood" className="w-64 rounded-lg border border-line bg-card px-3 py-2 text-sm" />
          </div>
        </div>

        {data?.error && <p className="mt-6 text-sm text-bad">{data.error}</p>}
        {!data && <p className="mt-10 text-sm text-muted">Loading listings…</p>}

        <ul className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {list.slice(0, limit).map((l) => (
            <li key={l.sid + (l.kind === 'home' ? l.listingId : l.unitName)}>
              <Link href={`/space/${l.sid}`} className="group block">
                <div className="aspect-[20/19] overflow-hidden rounded-xl bg-panel">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`https://my.matterport.com/api/v1/player/models/${l.sid}/thumb`} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" />
                </div>
                <div className="mt-3">
                  {l.kind === 'home' ? (
                    <>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold">{l.address}</span>
                        <span className="num shrink-0 text-[15px] font-semibold">{l.price ? fmtUsd(l.price) : ''}</span>
                      </div>
                      <div className="mt-0.5 text-sm text-muted">
                        {[l.beds && `${l.beds} bd`, l.baths && `${l.baths} ba`, l.sqft && `${l.sqft.toLocaleString()} sq ft`, l.yearBuilt && `built ${l.yearBuilt}`].filter(Boolean).join(' · ')}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold">{l.community ?? l.address}</span>
                        <span className="num shrink-0 text-[15px] font-semibold">{l.rentMin ? `${fmtUsd(l.rentMin)}+/mo` : ''}</span>
                      </div>
                      <div className="mt-0.5 truncate text-sm text-muted">
                        {l.unitName} · {l.address}
                      </div>
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {list.length > limit && (
          <div className="mt-8 text-center">
            <button onClick={() => setLimit(limit + 36)} className="rounded-lg border border-ink px-5 py-2 text-sm">
              Show more ({list.length - limit} left)
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
