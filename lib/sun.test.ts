import { describe, expect, it } from 'vitest';
import { dayTimes, homeTime, momentTime, solarPosition, sunTone, sunVector } from './sun';

describe('solarPosition', () => {
  const houston = { lat: 29.76, lon: -95.37 };
  it('puts the sun high in the south at noon and below the horizon at midnight', () => {
    const noon = solarPosition(homeTime(12 * 60 + 30, houston.lon, new Date('2026-11-15T12:00:00Z')), houston.lat, houston.lon);
    expect(noon.elevation).toBeGreaterThan(35);
    expect(noon.elevation).toBeLessThan(45); // mid-November, about 39° in Houston
    expect(noon.azimuth).toBeGreaterThan(160);
    expect(noon.azimuth).toBeLessThan(200);
    const midnight = solarPosition(homeTime(0, houston.lon, new Date('2026-11-15T12:00:00Z')), houston.lat, houston.lon);
    expect(midnight.elevation).toBeLessThan(-30);
  });

  it('rises in the east and sets in the west', () => {
    const morning = solarPosition(homeTime(8 * 60, houston.lon, new Date('2026-11-15T12:00:00Z')), houston.lat, houston.lon);
    const evening = solarPosition(homeTime(16 * 60 + 30, houston.lon, new Date('2026-11-15T12:00:00Z')), houston.lat, houston.lon);
    expect(morning.azimuth).toBeGreaterThan(100);
    expect(morning.azimuth).toBeLessThan(140);
    expect(evening.azimuth).toBeGreaterThan(220);
    expect(evening.azimuth).toBeLessThan(260);
    expect(morning.elevation).toBeGreaterThan(0);
  });
});

describe('sunVector and sunTone', () => {
  it('points the sun east at azimuth 90 and up with elevation', () => {
    const v = sunVector(90, 30);
    expect(v.x).toBeCloseTo(Math.cos(Math.PI / 6));
    expect(v.y).toBeCloseTo(0);
    expect(v.z).toBeCloseTo(0.5);
  });
  it('is warm and weak at sunrise, bright at noon, dark at night', () => {
    expect(sunTone(3).warmth).toBeGreaterThan(0.6);
    expect(sunTone(50).brightness).toBeGreaterThan(sunTone(3).brightness);
    expect(sunTone(-20).beamStrength).toBe(0);
    expect(sunTone(-20).brightness).toBeLessThan(0.6);
  });
});

describe('dayTimes', () => {
  it('finds a November day in Houston: sunrise about 6:50, sunset about 5:25', () => {
    const t = dayTimes(29.76, -95.37, new Date('2026-11-15T12:00:00Z'));
    expect(t.sunrise).toBeGreaterThan(6 * 60 + 30);
    expect(t.sunrise).toBeLessThan(7 * 60 + 10);
    expect(t.sunset).toBeGreaterThan(17 * 60 + 5);
    expect(t.sunset).toBeLessThan(17 * 60 + 45);
    expect(momentTime('golden', 29.76, -95.37, new Date('2026-11-15T12:00:00Z'))).toBeLessThan(t.sunset);
    expect(momentTime('night', 29.76, -95.37, new Date('2026-11-15T12:00:00Z'))).toBeGreaterThan(t.sunset + 60);
  });
});
