import { describe, expect, it } from 'vitest';
import type { LoadItem } from '../models/loads';
import { fmtLength, fmtWeight, toKg, toMetres } from '../models/loads';
import { checkLoad, itemFlags, planLoads, type TrailerSpec } from './loads';

const flatdeck: TrailerSpec = { id: 't1', deckLengthM: 14.63, deckWidthM: 2.59, deckHeightM: 1.52, maxPayloadKg: 21_000 };
const item = (key: string, p: Partial<LoadItem>): LoadItem => ({
  key,
  lotId: key,
  orderLineId: key,
  label: key,
  ref: key,
  uom: 'EA',
  qty: 1,
  unitWeightKg: null,
  lengthM: null,
  widthM: null,
  heightM: null,
  stackable: true,
  locationId: null,
  locationName: null,
  companyId: 'c',
  finalSiteId: 's',
  ...p,
});

describe('load builder', () => {
  it('splits heavy material into loads by the trailer payload', () => {
    // 40 piles at 1,200 kg = 48,000 kg → 17 per load on a 21,000 kg deck → 3 loads.
    const plan = planLoads([item('pile', { qty: 40, unitWeightKg: 1200, lengthM: 12, widthM: 0.33, heightM: 0.33 })], flatdeck);
    expect(plan.loads.map((l) => l.lines[0]!.qty)).toEqual([17, 17, 6]);
    expect(plan.loads[0]!.weightKg).toBe(20_400);
    expect(plan.loads[0]!.weightPct).toBeCloseTo(0.971, 3);
    expect(plan.totalWeightKg).toBe(48_000);
    expect(plan.loads.every((l) => l.flags.length === 0)).toBe(true);
  });

  it('fills by deck space when light but bulky, stacking where it fits', () => {
    // 2.4 × 1.2 crates, 1.0 m tall: clearance 4.15 − 1.52 = 2.63 → 2 high; deck 37.9 m² → 26 crates a load.
    const crates = item('crate', { qty: 30, unitWeightKg: 100, lengthM: 2.4, widthM: 1.2, heightM: 1.0 });
    const plan = planLoads([crates], flatdeck);
    expect(plan.loads.map((l) => l.lines[0]!.qty)).toEqual([26, 4]);
    // Not stackable → half as many a load.
    expect(planLoads([{ ...crates, stackable: false }], flatdeck).loads.map((l) => l.lines[0]!.qty)).toEqual([13, 13, 4]);
  });

  it('mixes items on a load and keeps the unsized ones on the first load', () => {
    const plan = planLoads(
      [item('beam', { qty: 2, unitWeightKg: 6000, lengthM: 14, widthM: 0.5, heightM: 1 }), item('bolts', { qty: 10, uom: 'BOX', unitWeightKg: 25 }), item('misc', { qty: 3 })],
      flatdeck,
    );
    expect(plan.loads).toHaveLength(1);
    expect(plan.loads[0]!.lines.map((l) => [l.key, l.qty])).toEqual([
      ['beam', 2],
      ['bolts', 10],
      ['misc', 3],
    ]);
    expect(plan.unsized).toEqual(['misc']);
    expect(plan.itemFlags.misc).toEqual(['NO_SIZE']);
  });

  it('flags oversize and overweight pieces and puts each on its own load', () => {
    expect(itemFlags({ unitWeightKg: 25_000, lengthM: 6, widthM: 2, heightM: 2 }, flatdeck)).toEqual(['OVERWEIGHT']);
    expect(itemFlags({ unitWeightKg: 5000, lengthM: 6, widthM: 3.2, heightM: 1 }, flatdeck)).toEqual(['PERMIT_WIDTH', 'TOO_WIDE']);
    expect(itemFlags({ unitWeightKg: 5000, lengthM: 6, widthM: 2, heightM: 3 }, flatdeck)).toEqual(['TOO_TALL']);
    expect(itemFlags({ unitWeightKg: 5000, lengthM: 15.2, widthM: 1, heightM: 1 }, flatdeck)).toEqual(['OVERHANG']);
    expect(itemFlags({ unitWeightKg: 5000, lengthM: 16, widthM: 1, heightM: 1 }, flatdeck)).toEqual(['TOO_LONG']);
    // Same tall item fits on a lowboy.
    expect(itemFlags({ unitWeightKg: 5000, lengthM: 6, widthM: 2, heightM: 3 }, { ...flatdeck, deckHeightM: 0.46 })).toEqual([]);

    const plan = planLoads([item('girder', { qty: 2, unitWeightKg: 8000, lengthM: 6, widthM: 3, heightM: 1 }), item('plate', { qty: 4, unitWeightKg: 500, lengthM: 2, widthM: 1, heightM: 0.1 })], flatdeck);
    expect(plan.loads).toHaveLength(3);
    expect(plan.loads[0]!.flags).toEqual(['PERMIT_WIDTH', 'TOO_WIDE']);
    expect(plan.loads[2]!.lines).toEqual([{ key: 'plate', qty: 4, weightKg: 2000 }]);
  });

  it('splits quantities that are not pieces (metres of pipe) by weight', () => {
    const plan = planLoads([item('pipe', { qty: 300.5, uom: 'M', unitWeightKg: 100 })], flatdeck);
    expect(plan.loads.map((l) => l.lines[0]!.qty)).toEqual([210, 90.5]);
  });

  it('checks what is already on a BOL', () => {
    const r = checkLoad([{ key: 'a', qty: 30, unitWeightKg: 800, lengthM: null, widthM: null, heightM: null, stackable: true }], flatdeck);
    expect(r).toMatchObject({ weightKg: 24_000, loadsNeeded: 2, flags: ['OVERWEIGHT'] });
  });

  it('shows feet and pounds or metres and kilograms', () => {
    expect(fmtLength(14.63, 'imperial')).toBe('48′');
    expect(fmtLength(2.59, 'imperial')).toBe('8′ 6″');
    expect(fmtLength(2.59, 'metric')).toBe('2.59 m');
    expect(fmtWeight(21_000, 'imperial')).toBe('46,297 lb');
    expect(toMetres(53, 'imperial')).toBeCloseTo(16.154, 3);
    expect(toKg(1000, 'imperial')).toBeCloseTo(453.59, 2);
  });
});
