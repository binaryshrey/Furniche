import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '@/catalog/products';
import { demoBudget, moveInBudget } from './budget';
import { compactRoom, designTotal, fitToBudget, floorStats, issuesFor, optimizeRoom, placeFree, styleRoom, swapFor, type Ctx, type WorkDesign } from './designOps';
import { warmthColor, clampLight, gradeFor, LIGHT_PRESETS } from './lighting';
import type { ModelGeometry, Room } from './types';

const rect = (id: string, label: string, w: number, d: number): Room => ({
  id,
  label,
  floorId: 'f',
  polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }],
  areaM2: w * d,
  widthM: w,
  depthM: d,
  heightM: 2.6,
  floorZ: 0,
});

const living = rect('r1', 'Living Room', 5, 4.2);
const geometry: ModelGeometry = {
  sid: 'test',
  name: 'Test home',
  address: null,
  lat: null,
  lon: null,
  defurnishedViewId: null,
  floors: [{ id: 'f', label: '1', z: 0 }],
  walls: {},
  rooms: [living],
  panos: [{ id: 'p', label: '', floorId: 'f', pos: { x: 2.5, y: 2.1, z: 1.5 } }],
};
const ctx: Ctx = { geometry, products: PRODUCTS };
const empty: WorkDesign = { items: [], surfaces: [], doors: [], themeId: null };
const id = (cat: string) => PRODUCTS.find((p) => p.category === cat && p.placement === 'floor')!.id;
const errors = (d: WorkDesign) => issuesFor(d, ctx).filter((i) => i.level === 'error');

describe('placeFree', () => {
  it('puts pieces one after another without fit errors', () => {
    let d = empty;
    for (const cat of ['sofa', 'coffee-table', 'armchair', 'floor-lamp', 'bookshelf']) {
      const p = PRODUCTS.find((x) => x.id === id(cat))!;
      const spot = placeFree(p, living, d, ctx);
      expect(spot, cat).not.toBeNull();
      d = { ...d, items: [...d.items, spot!] };
    }
    expect(errors(d)).toEqual([]);
  });

  it('returns null when the piece is bigger than the room', () => {
    const tiny = rect('r2', 'Office', 1.2, 1.2);
    const sofa = PRODUCTS.find((p) => p.category === 'sofa')!;
    expect(placeFree(sofa, tiny, empty, { ...ctx, geometry: { ...geometry, rooms: [tiny] } })).toBeNull();
  });
});

describe('optimizeRoom', () => {
  it('lays out the chosen pieces with no errors and reports open floor', () => {
    const ids = [id('sofa'), id('coffee-table'), id('rug'), id('tv-console'), id('plant')];
    const r = optimizeRoom(living, ids, empty, ctx);
    expect(r.placed).toBeGreaterThanOrEqual(4);
    expect(errors(r.design)).toEqual([]);
    expect(r.stats.freeShare).toBeGreaterThan(0.5);
    expect(r.stats.freeShare).toBeLessThan(1);
  });

  it('compact mode never leaves less open floor than before', () => {
    const styled = styleRoom(living, 'scandinavian', 4000, empty, ctx);
    const before = floorStats(living, styled.design.items, PRODUCTS);
    const r = compactRoom(living, styled.design, ctx);
    expect(r.stats.usedM2).toBeLessThanOrEqual(before.usedM2 + 1e-9);
  });
});

describe('swapFor and fitToBudget', () => {
  const styled = () => styleRoom(living, 'midcentury', 6000, empty, ctx).design;

  it('swaps a piece for a cheaper one that still fits in place', () => {
    const d = styled();
    const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
    const priciest = [...d.items].sort((a, b) => byId.get(b.productId)!.priceUsd - byId.get(a.productId)!.priceUsd)[0];
    const r = swapFor(d, priciest.uid, 'cheaper', ctx)!;
    expect(r).not.toBeNull();
    expect(r.to.priceUsd).toBeLessThan(r.from.priceUsd);
    expect(errors(r.design)).toEqual([]);
  });

  it('brings the total under the target and reports one change per piece', () => {
    const d = styled();
    const before = designTotal(d, PRODUCTS);
    const target = Math.round(before * 0.6);
    const r = fitToBudget(d, target, ctx);
    expect(r.total).toBeLessThan(before);
    if (r.met) expect(r.total).toBeLessThanOrEqual(target);
    const names = r.changes.map((c) => c.split(' → ')[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('moveInBudget', () => {
  it('keeps bills and a cushion out of what is safe to spend', () => {
    const b = demoBudget(0);
    // 4200 checking - 2082 bills - 500 cushion = 1618, plus 40% of 6500 savings = 2600.
    expect(b.cashFree).toBeCloseTo(1618);
    expect(b.savingsShare).toBeCloseTo(2600);
    expect(b.safeToSpend).toBeCloseTo(4218);
    expect(b.cardRoom).toBeCloseTo(1500);
    expect(b.rentShare).toBeCloseTo(1850 / 5700, 2);
  });

  it('grades a plan and phases what cash cannot cover', () => {
    expect(demoBudget(3000).status).toBe('comfortable');
    expect(demoBudget(5000).status).toBe('stretch');
    const over = demoBudget(9000);
    expect(over.status).toBe('over');
    expect(over.plan.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(9000);
    expect(over.plan.some((p) => p.label.startsWith('After paycheck'))).toBe(true);
  });

  it('flags rent above 30% of income', () => {
    const b = moveInBudget({
      source: 'demo',
      planned: 0,
      accounts: [],
      bills: [{ id: 'r', payee: 'Rent', amount: 2000, due: null }],
      txns: [{ id: 'd', kind: 'deposit', amount: 4000, description: '', status: 'completed', at: new Date().toISOString() }],
    });
    expect(b.notes[0]).toMatch(/above the 30% guideline/);
  });
});

describe('lighting', () => {
  it('clamps and tints', () => {
    expect(clampLight({ brightness: 5, warmth: -3 }, { brightness: 1, warmth: 0 })).toEqual({ brightness: 2, warmth: -1 });
    expect(warmthColor(0)).toBe('#fffaf0');
    expect(warmthColor(1)).toBe('#ffc88a');
  });

  it('grades evening and daylight very differently, and leaves neutral alone', () => {
    expect(gradeFor(LIGHT_PRESETS.neutral)).toBeNull();
    const eve = gradeFor(LIGHT_PRESETS.evening)!;
    const day = gradeFor(LIGHT_PRESETS.daylight)!;
    expect(eve.blend).toBe('multiply');
    expect(day.blend).toBe('screen');
    const b = (f: string) => Number(f.match(/brightness\(([\d.]+)\)/)![1]);
    expect(b(day.filter) - b(eve.filter)).toBeGreaterThan(0.3);
  });
});
