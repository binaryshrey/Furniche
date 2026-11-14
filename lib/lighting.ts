import { create } from 'zustand';

// How the furniture is lit, set from the chat ("make it brighter", "warmer evening light").
// brightness scales every light (1 = the room's own light); warmth tints them from cool daylight
// (-1, about 6500 K) through neutral (0) to warm lamp light (+1, about 2700 K).
export type LightPrefs = { brightness: number; warmth: number };

export const LIGHT_LIMITS = { brightness: [0.3, 2] as const, warmth: [-1, 1] as const };

export const clampLight = (p: Partial<LightPrefs>, cur: LightPrefs): LightPrefs => ({
  brightness: Math.min(LIGHT_LIMITS.brightness[1], Math.max(LIGHT_LIMITS.brightness[0], p.brightness ?? cur.brightness)),
  warmth: Math.min(LIGHT_LIMITS.warmth[1], Math.max(LIGHT_LIMITS.warmth[0], p.warmth ?? cur.warmth)),
});

export const useLighting = create<LightPrefs & { set: (p: Partial<LightPrefs>) => void }>((set, get) => ({
  brightness: 1,
  warmth: 0,
  set: (p) => set(clampLight(p, get())),
}));

// Light colour for a warmth value, as a hex string for three.js.
export function warmthColor(warmth: number): string {
  const cool = [0xdd, 0xe8, 0xff];
  const neutral = [0xff, 0xfa, 0xf0];
  const warm = [0xff, 0xc8, 0x8a];
  const [a, b, t] = warmth < 0 ? [neutral, cool, -warmth] : [neutral, warm, warmth];
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
