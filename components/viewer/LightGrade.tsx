'use client';
import { gradeFor, useLighting } from '@/lib/lighting';

// Grades the whole tour (the scan photo and the furniture) for the chosen light, so evening and
// daylight look clearly different: the furniture lights alone can't change the photo behind them.
// Two layers that never catch the mouse: a backdrop filter for exposure and colour, and a tint.
export default function LightGrade() {
  const brightness = useLighting((s) => s.brightness);
  const warmth = useLighting((s) => s.warmth);
  const g = gradeFor({ brightness, warmth });
  if (!g) return null;
  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[5] transition-[backdrop-filter] duration-700" style={{ backdropFilter: g.filter, WebkitBackdropFilter: g.filter }} aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-[5] transition-colors duration-700" style={{ background: g.tint, mixBlendMode: g.blend }} aria-hidden />
    </>
  );
}
