'use client';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { useAnchoredBox } from './useAnchoredBox';

// null on either end means "no limit" on that side.
export type PriceRange = { min: number | null; max: number | null };
export const NO_PRICE: PriceRange = { min: null, max: null };

const BARS = 24;
const BOX_WIDTH = 340;
const THUMB = 28; // keep in sync with .price-range in globals.css

const fmt = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const niceStep = (span: number) => [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000, 10000].find((s) => s >= span / 200) ?? 10000;

export function inRange(price: number | null, v: PriceRange) {
  if (v.min == null && v.max == null) return true;
  if (price == null) return false;
  return (v.min == null || price >= v.min) && (v.max == null || price <= v.max);
}

function label(v: PriceRange) {
  if (v.min == null && v.max == null) return 'Price';
  if (v.min == null) return `Up to ${fmt(v.max!)}`;
  if (v.max == null) return `${fmt(v.min)}+`;
  return `${fmt(v.min)} – ${fmt(v.max)}`;
}

// A "Price" pill that opens a box with a histogram of the listed prices and a two-handle slider,
// plus Minimum / Maximum fields.
export default function PriceFilter({ prices, value, onChange }: { prices: number[]; value: PriceRange; onChange: (v: PriceRange) => void }) {
  const { open, setOpen, pos, btn, box } = useAnchoredBox(BOX_WIDTH);
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);

  const bounds = useMemo(() => {
    if (prices.length < 2) return null;
    const lo0 = prices.reduce((a, b) => Math.min(a, b), Infinity);
    const hi0 = prices.reduce((a, b) => Math.max(a, b), -Infinity);
    if (lo0 === hi0) return null;
    const step = niceStep(hi0 - lo0);
    return { lo: Math.floor(lo0 / step) * step, hi: Math.ceil(hi0 / step) * step, step };
  }, [prices]);

  const bars = useMemo(() => {
    if (!bounds) return [];
    const span = bounds.hi - bounds.lo;
    const counts = new Array<number>(BARS).fill(0);
    for (const p of prices) counts[Math.min(BARS - 1, Math.floor(((p - bounds.lo) / span) * BARS))]++;
    const top = counts.reduce((a, b) => Math.max(a, b), 1);
    return counts.map((c, i) => ({ h: c / top, from: bounds.lo + (i / BARS) * span, to: bounds.lo + ((i + 1) / BARS) * span }));
  }, [prices, bounds]);

  const active = value.min != null || value.max != null;
  const lo = value.min ?? bounds?.lo ?? 0;
  const hi = value.max ?? bounds?.hi ?? 0;
  const span = bounds ? bounds.hi - bounds.lo : 1;
  const pct = (x: number) => ((x - (bounds?.lo ?? 0)) / span) * 100;

  const set = (min: number, max: number) => {
    if (!bounds) return;
    onChange({ min: min <= bounds.lo ? null : min, max: max >= bounds.hi ? null : max });
  };
  const commit = (which: 'min' | 'max') => {
    const raw = which === 'min' ? minDraft : maxDraft;
    if (which === 'min') setMinDraft(null);
    else setMaxDraft(null);
    if (raw == null || !bounds) return;
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    if (Number.isNaN(n)) return;
    if (which === 'min') set(Math.min(Math.max(n, bounds.lo), hi - bounds.step), hi);
    else set(lo, Math.max(Math.min(n, bounds.hi), lo + bounds.step));
  };

  const field = 'h-12 w-32 rounded-full border border-line bg-paper px-4 text-center text-sm outline-none focus:border-ink/40';

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          toggleVariants({ variant: 'outline' }),
          'shrink-0 rounded-full px-4',
          (active || open) && 'border-foreground',
          active && 'bg-foreground font-semibold text-background hover:bg-foreground hover:text-background',
        )}
      >
        {label(value)}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden className={cn('transition', open && 'rotate-180')}>
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={box}
            role="dialog"
            aria-label="Price range"
            style={{ top: pos.top, left: pos.left, width: BOX_WIDTH }}
            className="fixed z-[80] rounded-2xl border border-line bg-card p-5 shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
          >
            {bounds ? (
              <>
                <div className="relative h-24" aria-hidden>
                  <div className="absolute inset-x-[14px] bottom-0 top-0 flex items-end gap-[3px]">
                    {bars.map((b, i) => (
                      <div
                        key={i}
                        className={cn('flex-1 rounded-t-sm', b.to > lo && b.from < hi ? 'bg-brand' : 'bg-line')}
                        style={{ height: `${Math.max(b.h * 100, b.h > 0 ? 6 : 0)}%` }}
                      />
                    ))}
                  </div>
                </div>
                <div className="relative mt-1 h-7">
                  <div className="absolute left-[14px] right-[14px] top-1/2 h-[3px] -translate-y-1/2 rounded bg-line" />
                  <div
                    className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded bg-brand"
                    style={{
                      left: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${pct(lo) / 100})`,
                      right: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${1 - pct(hi) / 100})`,
                    }}
                  />
                  <input
                    type="range"
                    aria-label="Minimum price"
                    className="price-range"
                    style={{ zIndex: lo > bounds.lo + span / 2 ? 5 : 3 }}
                    min={bounds.lo}
                    max={bounds.hi}
                    step={bounds.step}
                    value={lo}
                    onChange={(e) => set(Math.min(Number(e.target.value), hi - bounds.step), hi)}
                  />
                  <input
                    type="range"
                    aria-label="Maximum price"
                    className="price-range"
                    style={{ zIndex: 4 }}
                    min={bounds.lo}
                    max={bounds.hi}
                    step={bounds.step}
                    value={hi}
                    onChange={(e) => set(lo, Math.max(Number(e.target.value), lo + bounds.step))}
                  />
                </div>
                <div className="mt-4 flex items-start justify-between">
                  <label className="grid gap-1.5 text-center text-xs text-muted">
                    Minimum
                    <input
                      className={field}
                      inputMode="numeric"
                      value={minDraft ?? fmt(lo)}
                      onFocus={(e) => (setMinDraft(String(Math.round(lo))), e.currentTarget.select())}
                      onChange={(e) => setMinDraft(e.target.value)}
                      onBlur={() => commit('min')}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </label>
                  <label className="grid gap-1.5 text-center text-xs text-muted">
                    Maximum
                    <input
                      className={field}
                      inputMode="numeric"
                      value={maxDraft ?? (value.max == null ? `${fmt(bounds.hi)}+` : fmt(hi))}
                      onFocus={(e) => (setMaxDraft(String(Math.round(hi))), e.currentTarget.select())}
                      onChange={(e) => setMaxDraft(e.target.value)}
                      onBlur={() => commit('max')}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    />
                  </label>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
                  <button type="button" onClick={() => onChange(NO_PRICE)} disabled={!active} className="font-semibold underline disabled:no-underline disabled:opacity-40">
                    Clear
                  </button>
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-foreground px-4 py-2 font-semibold text-background">
                    Done
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">Not enough priced listings here to set a range. Try another search.</p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
