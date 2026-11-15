"use client";
import { useEffect, useRef, useState } from "react";

const HANDLE = 52;
const PAD = 4;

// A swipe-to-confirm control: drag the handle across the track to pay. Letting go early snaps it
// back, so a stray tap never pays. The handle is also a button: Enter or Space confirms.
export default function SwipeToPay({
  label,
  disabled = false,
  busy = false,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const maxX = () => Math.max(0, (track.current?.clientWidth ?? 320) - HANDLE - PAD * 2);

  // After a failed payment the parent stops being busy: bring the handle home to try again.
  useEffect(() => {
    if (!busy) setX(0);
  }, [busy]);

  function down(e: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = e.clientX - x;
    setDragging(true);
  }
  function move(e: React.PointerEvent<HTMLButtonElement>) {
    if (!dragging) return;
    setX(Math.max(0, Math.min(maxX(), e.clientX - grab.current)));
  }
  function up() {
    if (!dragging) return;
    setDragging(false);
    if (x >= maxX() * 0.9) {
      setX(maxX());
      onConfirm();
    } else setX(0);
  }

  const progress = maxX() ? x / maxX() : 0;
  return (
    <div
      ref={track}
      className={`relative h-[60px] select-none overflow-hidden rounded-full border border-white/10 bg-[#0b2a4a] ${disabled ? "opacity-50" : ""}`}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#004977] to-[#1d7fc1]"
        style={{ width: x + HANDLE + PAD * 2, transition: dragging ? "none" : "width 220ms ease" }}
      />
      <span
        className="pointer-events-none absolute inset-0 grid place-items-center text-sm font-semibold tracking-wide text-white"
        style={{ opacity: 1 - progress * 1.2 }}
      >
        {busy ? "Processing payment…" : label}
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={disabled || busy}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled && !busy) {
            e.preventDefault();
            setX(maxX());
            onConfirm();
          }
        }}
        className="absolute top-1 grid touch-none place-items-center rounded-full bg-white text-[#004977] shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        style={{
          left: PAD + x,
          width: HANDLE,
          height: HANDLE,
          transition: dragging ? "none" : "left 220ms ease",
          cursor: disabled ? "not-allowed" : dragging ? "grabbing" : "grab",
        }}
      >
        {busy ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#004977]/30 border-t-[#004977]" />
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        )}
      </button>
    </div>
  );
}
