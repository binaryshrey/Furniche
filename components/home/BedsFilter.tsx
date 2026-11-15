'use client';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { toggleVariants } from '@/components/ui/toggle';
import { bedsLabel, NO_BEDS, parseBeds, type BedFilter } from '@/lib/beds';
import { cn } from '@/lib/utils';
import { useAnchoredBox } from './useAnchoredBox';

const BOX_WIDTH = 300;

// A "Beds" pill that opens a box with a text field, like the Price tab's box.
export default function BedsFilter({ value, onChange }: { value: BedFilter; onChange: (v: BedFilter) => void }) {
  const { open, setOpen, pos, btn, box } = useAnchoredBox(BOX_WIDTH);
  const input = useRef<HTMLInputElement>(null);
  const active = value.range != null;
  const unclear = value.text.trim() !== '' && value.range == null;

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

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
        {bedsLabel(value.range)}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden className={cn('transition', open && 'rotate-180')}>
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={box}
            role="dialog"
            aria-label="Bedrooms"
            style={{ top: pos.top, left: pos.left, width: BOX_WIDTH }}
            className="fixed z-[80] rounded-2xl border border-line bg-card p-5 shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
          >
            <label className="grid gap-1.5 text-xs text-muted">
              Bedrooms
              <input
                ref={input}
                value={value.text}
                onChange={(e) => onChange({ text: e.target.value, range: parseBeds(e.target.value) })}
                onKeyDown={(e) => e.key === 'Enter' && setOpen(false)}
                placeholder="e.g. 2, 2-3, 3+ or studio"
                aria-invalid={unclear}
                className={cn(
                  'h-12 rounded-full border bg-paper px-4 text-sm text-ink outline-none placeholder:text-muted focus:border-ink/40',
                  unclear ? 'border-destructive' : 'border-line',
                )}
              />
            </label>
            <p className={cn('mt-2 min-h-4 text-xs', unclear ? 'text-destructive' : 'text-muted')}>
              {unclear ? 'Try 2, 2-3, 3+ or studio.' : active ? `Showing ${bedsLabel(value.range).toLowerCase()}.` : 'Type a number, a range or 3+.'}
            </p>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
              <button
                type="button"
                onClick={() => onChange(NO_BEDS)}
                disabled={!value.text}
                className="font-semibold underline disabled:no-underline disabled:opacity-40"
              >
                Clear
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-foreground px-4 py-2 font-semibold text-background">
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
