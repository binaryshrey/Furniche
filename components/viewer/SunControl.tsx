"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { LIGHT_PRESETS, useLighting } from "@/lib/lighting";
import {
  clock,
  dayTimes,
  lightAt,
  momentTime,
  useSite,
  type SunMoment,
} from "@/lib/sun";
import type { ModelGeometry } from "@/lib/types";

const MOMENTS: { id: SunMoment; label: string }[] = [
  { id: "sunrise", label: "Sunrise" },
  { id: "morning", label: "Morning" },
  { id: "noon", label: "Noon" },
  { id: "afternoon", label: "Afternoon" },
  { id: "golden", label: "Golden hour" },
  { id: "night", label: "Night" },
];

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass = (deg: number) =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

function phase(elevation: number, minutes: number, noon: number): string {
  if (elevation < -8) return "Night";
  if (elevation < 0) return minutes < noon ? "Dawn" : "Dusk";
  if (elevation < 10) return minutes < noon ? "Sunrise" : "Golden hour";
  if (elevation < 30) return minutes < noon ? "Morning" : "Afternoon";
  return "Midday";
}

// Time of day for the tour: sunlight comes in through the windows and outside doors from where
// the sun really is at this home, from sunrise to night. Play runs through the whole day.
export default function SunControl({
  geometry,
}: {
  geometry: ModelGeometry | null;
}) {
  const sun = useLighting((s) => s.sun ?? null);
  const site = useSite();
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  // The home's location from the scan, and which way it faces (remembered per home).
  useEffect(() => {
    if (!geometry) return;
    let north = 0;
    try {
      north =
        Number(localStorage.getItem(`furniche:north:${geometry.sid}`) ?? 0) ||
        0;
    } catch {
      /* storage blocked */
    }
    useSite
      .getState()
      .set({
        ...(geometry.lat != null && geometry.lon != null
          ? { lat: geometry.lat, lon: geometry.lon }
          : {}),
        north,
      });
  }, [geometry]);

  const times = useMemo(
    () => dayTimes(site.lat, site.lon),
    [site.lat, site.lon],
  );
  const start = Math.floor((times.sunrise - 60) / 15) * 15;
  const end = Math.ceil((times.sunset + 150) / 15) * 15;
  const now =
    sun === null ? null : lightAt(sun, site.lat, site.lon, site.north);

  const setSun = (m: number | null) =>
    useLighting
      .getState()
      .set(m === null ? { ...LIGHT_PRESETS.neutral, sun: null } : { sun: m });

  // Play the day: sunrise to night in about 25 seconds.
  useEffect(() => {
    if (!playing) return;
    const from = sun !== null && sun < end - 30 ? sun : start;
    const t0 = performance.now();
    const span = end - from;
    const ms = (span / (end - start)) * 25000;
    let last = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      if (t - last > 60 || k === 1) {
        last = t;
        setSun(from + span * k);
      }
      if (k < 1) raf.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps

  function turnNorth(by: number) {
    const north = (((site.north + by) % 360) + 360) % 360;
    useSite.getState().set({ north });
    try {
      if (geometry)
        localStorage.setItem(`furniche:north:${geometry.sid}`, String(north));
    } catch {
      /* storage blocked */
    }
  }

  const label =
    sun === null
      ? "Time of day"
      : `${clock(sun)} · ${phase(now!.elevation, sun, times.noon)}`;
  return (
    <div data-fn-ui className="relative">
      <button
        onClick={() => {
          if (!open && sun === null)
            setSun(momentTime("morning", site.lat, site.lon));
          setOpen(!open);
        }}
        className={`flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 ${open ? "bg-ink text-paper" : "bg-card"}`}
        aria-label="Time of day"
        aria-expanded={open}
      >
        <SunIcon up={!now || now.elevation > 0} />
        {label}
      </button>
      {open && (
        <section
          className="absolute right-0 top-full z-50 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/10 bg-paper/45 p-3 text-xs shadow-swatch backdrop-blur-[2px] [text-shadow:0_1px_2px_rgba(0,0,0,.45)]"
          aria-label="Time of day settings"
        >
          <div className="flex items-center gap-2">
            <SunIcon up={!now || now.elevation > 0} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-semibold">
                {sun === null
                  ? "Sunlight off"
                  : `${clock(sun)} · ${phase(now!.elevation, sun, times.noon)}`}
              </p>
              <p className="text-[11px] text-muted">
                {now && now.elevation > 0
                  ? `Sun in the ${compass(now.azimuth)}, ${Math.round(now.elevation)}° up: light falls through the windows facing it`
                  : now
                    ? "The sun is down: the windows go dark"
                    : "Sunlight through the windows and doors, by time of day"}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md px-1.5 py-0.5 text-muted hover:bg-card"
              aria-label="Collapse time of day"
            >
              ✕
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => setPlaying((p) => !p)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full btn-brand text-sm"
              aria-label={
                playing ? "Pause the day" : "Play the day from sunrise to night"
              }
              title={playing ? "Pause" : "Play the day"}
            >
              {playing ? "❚❚" : "▶"}
            </button>
            <input
              type="range"
              min={start}
              max={end}
              step={5}
              value={sun ?? momentTime("morning", site.lat, site.lon)}
              onChange={(e) => {
                setPlaying(false);
                setSun(Number(e.target.value));
              }}
              className="h-2 flex-1 cursor-pointer accent-[#ffb04a]"
              style={{
                background: dayGradient(start, end, times),
                borderRadius: 999,
                appearance: "none",
              }}
              aria-label="Time of day"
              aria-valuetext={sun === null ? "off" : clock(sun)}
            />
          </div>
          <div className="mt-1 flex justify-between px-10 text-[10px] text-muted">
            <span>☀︎↑ {clock(times.sunrise)}</span>
            <span>☀︎↓ {clock(times.sunset)}</span>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {MOMENTS.map((m) => {
              const t = momentTime(m.id, site.lat, site.lon);
              const on = sun !== null && Math.abs(sun - t) < 8;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    setPlaying(false);
                    setSun(t);
                  }}
                  className={`rounded-full border px-2.5 py-1 ${on ? "border-transparent bg-ink text-paper" : "border-line bg-card/70 hover:bg-card"}`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-2 text-[11px] text-muted">
            <span title="Scans don't record which way is north. Turn the compass until the morning sun comes in the east windows.">
              Facing: north is{" "}
              {site.north ? `${site.north}° round` : "up the plan"}
            </span>
            <button
              onClick={() => turnNorth(-45)}
              className="rounded-md border border-line bg-card/70 px-1.5 py-0.5 hover:bg-card"
              aria-label="Turn the compass left"
            >
              ↺
            </button>
            <button
              onClick={() => turnNorth(45)}
              className="rounded-md border border-line bg-card/70 px-1.5 py-0.5 hover:bg-card"
              aria-label="Turn the compass right"
            >
              ↻
            </button>
            <button
              onClick={() => {
                setPlaying(false);
                setSun(null);
              }}
              className="ml-auto rounded-md px-1.5 py-0.5 hover:bg-card"
            >
              Turn off
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// Slider track: night blue, dawn orange, day pale, dusk orange, night.
function dayGradient(
  start: number,
  end: number,
  t: { sunrise: number; sunset: number },
) {
  const at = (m: number) =>
    `${(((m - start) / (end - start)) * 100).toFixed(1)}%`;
  return `linear-gradient(90deg, #1b2346 0%, #3a3f6e ${at(t.sunrise - 30)}, #ff9a5c ${at(t.sunrise)}, #ffe0a8 ${at(t.sunrise + 90)}, #fff4dc 50%, #ffe0a8 ${at(t.sunset - 90)}, #ff8a4c ${at(t.sunset)}, #3a3f6e ${at(t.sunset + 40)}, #1b2346 100%)`;
}

function SunIcon({ up }: { up: boolean }) {
  return up ? (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffb04a"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4" fill="#ffb04a" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#c9d4ff" aria-hidden>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}
