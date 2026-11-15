import { create } from 'zustand';

// Where the sun is for the home's location at a time of day, and what that light looks like.
// Positions use the standard low-precision solar formulas (good to well under a degree), which
// is plenty for light through a window.

const RAD = Math.PI / 180;

// Sun azimuth (degrees clockwise from north) and elevation (degrees above the horizon).
export function solarPosition(date: Date, lat: number, lon: number): { azimuth: number; elevation: number } {
  const d = date.getTime() / 86400000 - 10957.5; // days since J2000.0 (2000-01-01 12:00 UTC)
  const g = (357.529 + 0.98560028 * d) * RAD; // mean anomaly
  const q = 280.459 + 0.98564736 * d; // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24; // hours
  const H = (gmst * 15 + lon) * RAD - ra; // hour angle
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azimuth = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { azimuth: ((azimuth / RAD) % 360 + 360) % 360, elevation: elevation / RAD };
}

// A local clock time at the home (minutes after midnight, today) as a Date. The time zone is taken
// from the longitude (15° per hour), which matches standard time for most of the US.
export function homeTime(minutes: number, lon: number, day = new Date()): Date {
  const offsetHours = Math.round(lon / 15);
  const utc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0) + (minutes - offsetHours * 60) * 60000;
  return new Date(utc);
}

// Unit vector toward the sun in Model API coordinates (x, y on the floor, z up). Matterport scans
// aren't aligned to north, so `north` (degrees) turns the compass to match the home.
export function sunVector(azimuth: number, elevation: number, north = 0): { x: number; y: number; z: number } {
  const az = (azimuth - north) * RAD;
  const el = elevation * RAD;
  return { x: Math.sin(az) * Math.cos(el), y: Math.cos(az) * Math.cos(el), z: Math.sin(el) };
}

// What daylight looks like at an elevation: the whole-tour grade and the colour and strength of a
// sunbeam. Low sun is amber and weak, high sun bright and near white; after dusk, a dim blue night.
const mix = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
export function sunTone(elevation: number): { brightness: number; warmth: number; beam: string; beamStrength: number } {
  if (elevation < -8) return { brightness: 0.5, warmth: -0.55, beam: '#9fb4ff', beamStrength: 0 }; // night
  if (elevation < 0) {
    const t = (elevation + 8) / 8; // twilight: blue hour into the last glow
    return { brightness: mix(0.5, 0.68, t), warmth: mix(-0.55, 0.75, t), beam: '#ff9a5c', beamStrength: 0 };
  }
  if (elevation < 10) {
    const t = elevation / 10; // sunrise / golden hour
    return { brightness: mix(0.72, 0.95, t), warmth: mix(0.95, 0.45, t), beam: '#ffa45c', beamStrength: mix(0.6, 0.9, t) };
  }
  if (elevation < 35) {
    const t = (elevation - 10) / 25;
    return { brightness: mix(0.95, 1.3, t), warmth: mix(0.45, -0.45, t), beam: t < 0.5 ? '#ffd08a' : '#fff0d0', beamStrength: 0.9 };
  }
  return { brightness: 1.32, warmth: -0.5, beam: '#fff6e6', beamStrength: 0.85 }; // midday
}

// The colour of the sky seen through a window: deep blue at night, orange at the horizon, pale blue by day.
export function skyTone(elevation: number): { color: string; night: number } {
  if (elevation < -8) return { color: '#0d1630', night: 1 };
  if (elevation < 0) return { color: '#3a3f6e', night: (-elevation) / 8 };
  if (elevation < 8) return { color: '#ffb27a', night: 0 };
  return { color: '#d8ecff', night: 0 };
}

// Today's sunrise, solar noon and sunset at the home, as local minutes after midnight.
export function dayTimes(lat: number, lon: number, day = new Date()): { sunrise: number; noon: number; sunset: number } {
  let sunrise = 6 * 60;
  let sunset = 18 * 60;
  let noon = 12 * 60;
  let best = -90;
  let prev = solarPosition(homeTime(0, lon, day), lat, lon).elevation;
  for (let m = 5; m <= 1440; m += 5) {
    const e = solarPosition(homeTime(m, lon, day), lat, lon).elevation;
    if (prev < 0 && e >= 0) sunrise = m - (5 * e) / (e - prev);
    if (prev >= 0 && e < 0) sunset = m - (5 * e) / (e - prev);
    if (e > best) [best, noon] = [e, m];
    prev = e;
  }
  return { sunrise, noon, sunset };
}

// Named moments of the day, from today's real sunrise and sunset.
export type SunMoment = 'sunrise' | 'morning' | 'noon' | 'afternoon' | 'golden' | 'night';
export function momentTime(moment: SunMoment, lat: number, lon: number, day = new Date()): number {
  const t = dayTimes(lat, lon, day);
  return {
    sunrise: t.sunrise + 20,
    morning: t.sunrise + 120,
    noon: t.noon,
    afternoon: (t.noon + t.sunset) / 2,
    golden: t.sunset - 35,
    night: t.sunset + 110,
  }[moment];
}

export const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// The whole-tour light for a time of day at the home.
export function lightAt(minutes: number, lat: number, lon: number, north = 0, day = new Date()) {
  const { azimuth, elevation } = solarPosition(homeTime(minutes, lon, day), lat, lon);
  return { azimuth, elevation, dir: sunVector(azimuth, elevation, north), tone: sunTone(elevation), sky: skyTone(elevation) };
}

// Where the home is and which way it faces, set by the editor once the scan loads.
export const useSite = create<{ lat: number; lon: number; north: number; set: (p: Partial<{ lat: number; lon: number; north: number }>) => void }>((set) => ({
  lat: 29.76, // Houston, until the scan says otherwise
  lon: -95.37,
  north: 0,
  set: (p) => set(p),
}));
