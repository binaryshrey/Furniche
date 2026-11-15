import { create } from 'zustand';
import { lightAt, useSite } from './sun';

// How the furniture is lit, set from the chat ("make it brighter", "warmer evening light").
// brightness scales every light (1 = the room's own light); warmth tints them from cool daylight
// (-1, about 6500 K) through neutral (0) to warm lamp light (+1, about 2700 K).
// sun: the time of day (local minutes after midnight) when sunlight comes in through the windows
// and outside doors, or null for no sunbeams.
export type LightPrefs = { brightness: number; warmth: number; sun?: number | null };

export const LIGHT_LIMITS = { brightness: [0.3, 2] as const, warmth: [-1, 1] as const };

export const clampLight = (p: Partial<LightPrefs>, cur: LightPrefs): LightPrefs => ({
  brightness: Math.min(LIGHT_LIMITS.brightness[1], Math.max(LIGHT_LIMITS.brightness[0], p.brightness ?? cur.brightness)),
  warmth: Math.min(LIGHT_LIMITS.warmth[1], Math.max(LIGHT_LIMITS.warmth[0], p.warmth ?? cur.warmth)),
  sun: p.sun !== undefined ? (p.sun === null ? null : ((p.sun % 1440) + 1440) % 1440) : (cur.sun ?? null),
});

// Setting a time of day alone also sets the tour's brightness and warmth from the sun.
export const useLighting = create<LightPrefs & { set: (p: Partial<LightPrefs>) => void }>((set, get) => ({
  brightness: 1,
  warmth: 0,
  sun: null,
  set: (p) => {
    if (typeof p.sun === 'number' && p.brightness === undefined && p.warmth === undefined) {
      const { lat, lon } = useSite.getState();
      const { tone } = lightAt(p.sun, lat, lon);
      p = { ...p, brightness: tone.brightness, warmth: tone.warmth };
    }
    set(clampLight(p, get()));
  },
}));

// Light colour for a warmth value, as a hex string for three.js.
export function warmthColor(warmth: number): string {
  const cool = [0xdd, 0xe8, 0xff];
  const neutral = [0xff, 0xfa, 0xf0];
  const warm = [0xff, 0xc8, 0x8a];
  const [a, b, t] = warmth < 0 ? [neutral, cool, -warmth] : [neutral, warm, warmth];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// Named looks, far enough apart to read at a glance.
export const LIGHT_PRESETS = {
  evening: { brightness: 0.7, warmth: 0.9 }, // low, amber lamp light
  daylight: { brightness: 1.35, warmth: -0.7 }, // bright, cool window light
  neutral: { brightness: 1, warmth: 0 },
} satisfies Record<string, LightPrefs>;

// CSS grade for the whole tour. null at neutral light (no overlay at all).
export function gradeFor({ brightness, warmth }: Pick<LightPrefs, 'brightness' | 'warmth'>): { filter: string; tint: string; blend: 'multiply' | 'screen' } | null {
  if (Math.abs(brightness - 1) < 0.02 && Math.abs(warmth) < 0.02) return null;
  const warm = Math.max(0, warmth);
  const cool = Math.max(0, -warmth);
  const filter = [
    `brightness(${(0.5 + 0.5 * brightness).toFixed(3)})`,
    `saturate(${(1 + 0.3 * warm - 0.1 * cool).toFixed(3)})`,
    `sepia(${(0.35 * warm).toFixed(3)})`,
    `hue-rotate(${(-6 * warm + 10 * cool).toFixed(1)}deg)`,
    `contrast(${(1 + 0.06 * warm + 0.04 * cool).toFixed(3)})`,
  ].join(' ');
  if (cool > 0 && brightness < 0.8) {
    // Night: darker and blue, not the airy lift that daylight gets.
    const n = Math.min(1, (0.8 - brightness) / 0.3);
    return { filter, tint: `rgba(40, 60, 140, ${(0.22 + 0.2 * n).toFixed(3)})`, blend: 'multiply' };
  }
  return warm > 0
    ? { filter, tint: `rgba(255, 128, 40, ${(0.24 * warm).toFixed(3)})`, blend: 'multiply' } // amber dusk
    : { filter, tint: `rgba(175, 210, 255, ${(0.16 * cool).toFixed(3)})`, blend: 'screen' }; // airy daylight
}
