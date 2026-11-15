'use client';
import { useEffect, useRef, useState } from 'react';

// Open/close state and placement for a popup box that hangs under its button. The box is meant to
// be rendered in a portal with `position: fixed` at `pos` (the sticky header's backdrop-filter would
// otherwise trap a fixed child). It closes on Escape or a click outside both the button and the box.
export function useAnchoredBox(width: number) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 10, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, width]);

  return { open, setOpen, pos, btn, box };
}
