// Load builder: split material into truckloads for a trailer, by weight and deck
// area (pieces stack when they're stackable and the height allows), and flag
// anything oversize or overweight. Approximate by design — a planning aid, not
// a load-securement calculation.

import { LEGAL_HEIGHT_M, LEGAL_WIDTH_M, REAR_OVERHANG_M, type LoadFlag, type LoadItem, type LoadPlan, type PlannedLoad } from '../models/loads';

export interface TrailerSpec {
  id: string | null;
  deckLengthM: number;
  deckWidthM: number;
  deckHeightM: number;
  maxHeightM?: number;
  maxWidthM?: number;
  maxPayloadKg: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** What's wrong with one piece of this item on this trailer. */
export function itemFlags(item: Pick<LoadItem, 'unitWeightKg' | 'lengthM' | 'widthM' | 'heightM'>, t: TrailerSpec): LoadFlag[] {
  const flags: LoadFlag[] = [];
  const { unitWeightKg: w, lengthM: l, widthM: wd, heightM: h } = item;
  if (w == null && l == null && wd == null && h == null) return ['NO_SIZE'];
  if (w != null && w > t.maxPayloadKg) flags.push('OVERWEIGHT');
  // Long side runs along the deck.
  const along = l != null && wd != null ? Math.max(l, wd) : (l ?? null);
  const across = l != null && wd != null ? Math.min(l, wd) : (wd ?? null);
  if (across != null) {
    if (across > (t.maxWidthM ?? LEGAL_WIDTH_M)) flags.push('PERMIT_WIDTH');
    if (across > t.deckWidthM) flags.push('TOO_WIDE');
  }
  if (h != null && t.deckHeightM + h > (t.maxHeightM ?? LEGAL_HEIGHT_M)) flags.push('TOO_TALL');
  if (along != null) {
    if (along > t.deckLengthM + REAR_OVERHANG_M) flags.push('TOO_LONG');
    else if (along > t.deckLengthM) flags.push('OVERHANG');
  }
  return flags;
}

/** A piece too big to share the deck (it goes on its own load). */
const SOLO: LoadFlag[] = ['OVERWEIGHT', 'TOO_WIDE', 'TOO_LONG', 'PERMIT_WIDTH'];

export function planLoads(items: LoadItem[], t: TrailerSpec): LoadPlan {
  const deckArea = t.deckLengthM * t.deckWidthM;
  const clearance = Math.max(0, (t.maxHeightM ?? LEGAL_HEIGHT_M) - t.deckHeightM);
  const itemFlagsMap: Record<string, LoadFlag[]> = {};
  const unsized: string[] = [];
  type Open = PlannedLoad & { area: number; solo: boolean };
  const loads: Open[] = [];
  const newLoad = (solo = false): Open => {
    const l: Open = { no: loads.length + 1, lines: [], weightKg: 0, weightPct: 0, areaPct: 0, flags: [], area: 0, solo };
    loads.push(l);
    return l;
  };
  const put = (load: Open, item: LoadItem, qty: number, w: number, a: number) => {
    const existing = load.lines.find((x) => x.key === item.key);
    if (existing) {
      existing.qty = round3(existing.qty + qty);
      existing.weightKg = round3(existing.weightKg + qty * w);
    } else load.lines.push({ key: item.key, qty: round3(qty), weightKg: round3(qty * w) });
    load.weightKg += qty * w;
    load.area += qty * a;
    for (const f of itemFlagsMap[item.key] ?? []) if (f !== 'NO_SIZE' && !load.flags.includes(f)) load.flags.push(f);
  };

  const sized: { item: LoadItem; w: number; a: number }[] = [];
  for (const item of items) {
    const flags = itemFlags(item, t);
    itemFlagsMap[item.key] = flags;
    if (flags.includes('NO_SIZE')) {
      unsized.push(item.key);
      continue;
    }
    const w = item.unitWeightKg ?? 0;
    const footprint = item.lengthM != null && item.widthM != null ? Math.min(item.lengthM * item.widthM, deckArea) : 0;
    const layers = item.stackable && item.heightM && item.heightM > 0 ? Math.max(1, Math.floor(clearance / item.heightM)) : 1;
    sized.push({ item, w, a: footprint / layers });
  }
  // Biggest and heaviest first: they're the hardest to place.
  sized.sort((x, y) => y.a * Math.max(y.w, 1) - x.a * Math.max(x.w, 1) || y.w - x.w);

  for (const { item, w, a } of sized) {
    const whole = Number.isInteger(item.qty);
    const fit = (load: Open) => {
      const byW = w > 0 ? (t.maxPayloadKg - load.weightKg) / w : Infinity;
      const byA = a > 0 ? (deckArea - load.area) / a : Infinity;
      const n = Math.min(item.qty, byW, byA);
      return whole ? Math.floor(n + 1e-9) : Math.floor(n * 1000) / 1000;
    };
    let left = item.qty;
    const solo = (itemFlagsMap[item.key] ?? []).some((f) => SOLO.includes(f));
    if (solo) {
      // One piece per load (or the whole quantity if it isn't counted in pieces).
      while (left > 1e-9) {
        const q = whole ? 1 : left;
        put(newLoad(true), item, q, w, a);
        left = round3(left - q);
      }
      continue;
    }
    for (const load of loads) {
      if (left <= 1e-9) break;
      if (load.solo) continue;
      const n = Math.min(left, fit(load));
      if (n > 0) {
        put(load, item, n, w, a);
        left = round3(left - n);
      }
    }
    while (left > 1e-9) {
      const load = newLoad();
      const n = Math.min(left, fit(load)) || (whole ? 1 : left); // a piece always goes somewhere
      put(load, item, n, w, a);
      left = round3(left - n);
    }
  }
  // Unsized items ride on the first load (or their own if there's nothing else).
  if (unsized.length) {
    const first = loads.find((l) => !l.solo) ?? newLoad();
    for (const key of unsized) {
      const item = items.find((i) => i.key === key)!;
      put(first, item, item.qty, 0, 0);
    }
  }
  const out = loads.map(({ area, solo: _solo, ...l }) => ({
    ...l,
    weightKg: round3(l.weightKg),
    weightPct: t.maxPayloadKg > 0 ? round3(l.weightKg / t.maxPayloadKg) : 0,
    areaPct: deckArea > 0 ? round3(area / deckArea) : 0,
    flags: l.weightKg > t.maxPayloadKg + 1e-6 && !l.flags.includes('OVERWEIGHT') ? [...l.flags, 'OVERWEIGHT' as LoadFlag] : l.flags,
  }));
  return {
    trailerId: t.id,
    loads: out,
    itemFlags: itemFlagsMap,
    totalWeightKg: round3(out.reduce((s, l) => s + l.weightKg, 0)),
    unsized,
  };
}

/** Weight and flags of what's already on a BOL, against its trailer. */
export function checkLoad(items: Pick<LoadItem, 'key' | 'qty' | 'unitWeightKg' | 'lengthM' | 'widthM' | 'heightM' | 'stackable'>[], t: TrailerSpec) {
  const plan = planLoads(
    items.map((i) => ({ ...i, lotId: null, orderLineId: '', label: '', ref: '', uom: '', locationId: null, locationName: null, companyId: '', finalSiteId: '' })),
    t,
  );
  const weightKg = plan.totalWeightKg;
  const flags = [...new Set(plan.loads.flatMap((l) => l.flags))];
  if (weightKg > t.maxPayloadKg && !flags.includes('OVERWEIGHT')) flags.push('OVERWEIGHT');
  return { weightKg, weightPct: t.maxPayloadKg ? round3(weightKg / t.maxPayloadKg) : 0, loadsNeeded: plan.loads.length, flags, unsized: plan.unsized.length };
}
