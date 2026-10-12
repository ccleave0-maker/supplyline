// Quantity math for the site inventory list. Quantities can be fractional
// (e.g. 2.5 TON), so everything is rounded to 3 decimals to avoid float drift.

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface SiteInventoryTotals {
  qtyOrdered: number;
  qtyShipped: number;
  qtyReceived: number;
  qtyReturned: number;
}

export interface SiteInventoryView extends SiteInventoryTotals {
  /** Still at the yard / not yet shipped. Never negative. */
  leftToShip: number;
  /** Shipped but not yet confirmed on site. */
  inTransit: number;
  /** Physically on site now (received minus returned). */
  onSite: number;
  partiallyShipped: boolean;
}

export function siteInventoryView(t: SiteInventoryTotals): SiteInventoryView {
  const ordered = round3(t.qtyOrdered);
  const shipped = round3(t.qtyShipped);
  const received = round3(t.qtyReceived);
  const returned = round3(t.qtyReturned);
  return {
    qtyOrdered: ordered,
    qtyShipped: shipped,
    qtyReceived: received,
    qtyReturned: returned,
    leftToShip: Math.max(0, round3(ordered - shipped)),
    inTransit: Math.max(0, round3(shipped - received)),
    onSite: Math.max(0, round3(received - returned)),
    partiallyShipped: shipped > 0 && shipped < ordered,
  };
}

/** Sum a list of quantities safely. */
export function sumQty(values: (number | string | null | undefined)[]): number {
  return round3(values.reduce<number>((acc, v) => acc + (v == null || v === '' ? 0 : Number(v)), 0));
}

/** Parses what someone typed in a quantity cell: "5", "2.5", "1,200". Returns null if not a positive number. */
export function parseQty(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = round3(Number(cleaned));
  return n > 0 ? n : null;
}

/** Extended cost in CAD, rounded to cents. */
export function extendedCost(qty: number, unitCost: number | null | undefined): number | null {
  if (unitCost == null) return null;
  return Math.round(qty * unitCost * 100) / 100;
}

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
export const formatCad = (n: number | null | undefined) => (n == null ? '' : cad.format(n));

export function formatQty(n: number | string | null | undefined): string {
  if (n == null || n === '') return '';
  return round3(Number(n)).toLocaleString('en-CA', { maximumFractionDigits: 3 });
}
