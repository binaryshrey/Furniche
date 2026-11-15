'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toggleVariants } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { useAnchoredBox } from './useAnchoredBox';

const BOX_WIDTH = 420; // wide enough for the placeholder and the hint to stay on one line

// A "Location" pill that opens a box with a text field, like the Beds tab's box. Unlike Beds it
// searches again (the server understands "apartments in <place>": an address, community, city or
// a named area such as the Heights), so `value` is the place currently searched and `onApply`
// runs the search; an empty string goes back to all apartments.
export default function LocationFilter({ value, onApply }: { value: string; onApply: (place: string) => void }) {
  const { open, setOpen, pos, btn, box } = useAnchoredBox(BOX_WIDTH);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const active = value !== '';

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    input.current?.focus();
  }, [open, value]);

  const apply = (text: string) => {
    const next = text.trim();
    if (next !== value) onApply(next);
  };
  const finish = () => {
    apply(draft);
    setOpen(false);
  };

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
        <span className="max-w-[10rem] truncate">{active ? value : 'Location'}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden className={cn('transition', open && 'rotate-180')}>
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={box}
            role="dialog"
            aria-label="Location"
            style={{ top: pos.top, left: pos.left, width: BOX_WIDTH, maxWidth: 'calc(100vw - 16px)' }}
            className="fixed z-[80] rounded-2xl border border-line bg-card p-5 shadow-[0_12px_40px_rgba(0,0,0,0.6)]"
          >
            <label className="grid gap-1.5 text-xs text-muted">
              Where
              <input
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && finish()}
                placeholder="e.g. Montrose, The Heights or a street"
                className="h-12 rounded-full border border-line bg-paper px-4 text-sm text-ink outline-none placeholder:text-muted focus:border-ink/40"
              />
            </label>
            <p className="mt-2 min-h-4 text-xs text-muted">
              {active ? `Showing apartments in ${value}.` : 'Type a neighbourhood, street or city, then press Enter.'}
            </p>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
              <button
                type="button"
                onClick={() => {
                  setDraft('');
                  apply('');
                }}
                disabled={!draft && !active}
                className="font-semibold underline disabled:no-underline disabled:opacity-40"
              >
                Clear
              </button>
              <button type="button" onClick={finish} className="rounded-lg bg-foreground px-4 py-2 font-semibold text-background">
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
