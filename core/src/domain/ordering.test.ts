import { describe, expect, it } from 'vitest';
import {
  canCancelLine,
  canTransition,
  assertTransition,
  checkDraftRows,
  deriveLineStatus,
  qtyToProcure,
  deriveOrderStatus,
  extendedCost,
  formatCad,
  parseQty,
  siteInventoryView,
  sumQty,
} from './index';

describe('line status changes', () => {
  it('follows the normal path from draft to received on site', () => {
    const path = ['DRAFT', 'SUBMITTED', 'SENT_FOR_RFQ', 'ON_ORDER', 'RECEIVED_AT_YARD', 'SHIPPED_PARTIAL', 'SHIPPED', 'RECEIVED_ON_SITE', 'RETURNED'] as const;
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
  });

  it('allows the yard-stock path', () => {
    expect(canTransition('SUBMITTED', 'YARD_STOCK')).toBe(true);
    expect(canTransition('YARD_STOCK', 'SHIPPED')).toBe(true);
  });

  it('blocks going backwards or skipping steps', () => {
    expect(canTransition('SHIPPED', 'SUBMITTED')).toBe(false);
    expect(canTransition('DRAFT', 'SHIPPED')).toBe(false);
    expect(canTransition('CANCELLED', 'SUBMITTED')).toBe(false);
    expect(() => assertTransition('RECEIVED_ON_SITE', 'ON_ORDER')).toThrow(/can't go from/);
  });

  it('only allows cancelling before anything has moved', () => {
    expect(canCancelLine('DRAFT')).toBe(true);
    expect(canCancelLine('SUBMITTED')).toBe(true);
    expect(canCancelLine('ON_ORDER')).toBe(true);
    expect(canCancelLine('RECEIVED_AT_YARD')).toBe(false);
    expect(canCancelLine('SHIPPED')).toBe(false);
  });

  it('derives the order status from its lines', () => {
    expect(deriveOrderStatus([])).toBe('DRAFT');
    expect(deriveOrderStatus(['DRAFT', 'DRAFT'])).toBe('DRAFT');
    expect(deriveOrderStatus(['SUBMITTED', 'SUBMITTED'])).toBe('SUBMITTED');
    expect(deriveOrderStatus(['SUBMITTED', 'CANCELLED'])).toBe('SUBMITTED');
    expect(deriveOrderStatus(['SUBMITTED', 'ON_ORDER'])).toBe('IN_PROGRESS');
    expect(deriveOrderStatus(['RECEIVED_ON_SITE', 'CANCELLED', 'RETURNED'])).toBe('COMPLETE');
    expect(deriveOrderStatus(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
  });
});

describe('site inventory math', () => {
  it('nothing shipped yet: everything is left to ship', () => {
    expect(siteInventoryView({ qtyOrdered: 10, qtyShipped: 0, qtyReceived: 0, qtyReturned: 0 })).toMatchObject({
      leftToShip: 10,
      inTransit: 0,
      onSite: 0,
      partiallyShipped: false,
    });
  });

  it('partial shipment: 5 ordered, 4 shipped, 3 received', () => {
    expect(siteInventoryView({ qtyOrdered: 5, qtyShipped: 4, qtyReceived: 3, qtyReturned: 0 })).toMatchObject({
      leftToShip: 1,
      inTransit: 1,
      onSite: 3,
      partiallyShipped: true,
    });
  });

  it('returns reduce what is on site; over-shipping never shows negative left to ship', () => {
    expect(siteInventoryView({ qtyOrdered: 5, qtyShipped: 6, qtyReceived: 6, qtyReturned: 2 })).toMatchObject({
      leftToShip: 0,
      onSite: 4,
      partiallyShipped: false,
    });
  });

  it('handles fractional quantities without float drift', () => {
    expect(siteInventoryView({ qtyOrdered: 0.3, qtyShipped: 0.1, qtyReceived: 0, qtyReturned: 0 }).leftToShip).toBe(0.2);
    expect(sumQty(['0.1', 0.2, null, ''])).toBe(0.3);
  });
});

describe('checking draft rows before submit', () => {
  const row = (p: Partial<Record<string, string>>) => ({
    description: '',
    quantity: '',
    uom: '',
    costCode: '',
    orderedByInitials: 'JS',
    requiredOnSite: '',
    ...p,
  });

  it('skips blank rows and cleans good ones', () => {
    const r = checkDraftRows(
      [row({ description: ' 20M rebar 6m ', quantity: '1,200', uom: 'ea', costCode: 'c-100', requiredOnSite: '2026-10-20' }), row({})],
      ['C-100'],
    );
    expect(r.ok).toBe(true);
    expect(r.lines).toEqual([
      { description: '20M rebar 6m', quantity: 1200, uom: 'EA', costCode: 'C-100', orderedByInitials: 'JS', requiredOnSite: '2026-10-20' },
    ]);
  });

  it('flags each bad cell by row number', () => {
    const r = checkDraftRows([row({}), row({ description: 'Pipe', quantity: 'abc', uom: '', costCode: 'X', requiredOnSite: '2026-02-30' })], ['C-100']);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors[2]!).sort()).toEqual(['costCode', 'quantity', 'requiredOnSite', 'uom']);
    expect(r.message).toMatch(/Fix 1 line/);
  });

  it('allows any cost code when the company has no list', () => {
    expect(checkDraftRows([row({ description: 'Gravel', quantity: '12', uom: 'TON', costCode: 'anything' })], []).ok).toBe(true);
  });

  it('needs at least one line', () => {
    expect(checkDraftRows([row({})], []).message).toMatch(/at least one line/);
  });
});

describe('quantities and money', () => {
  it('parses typed quantities', () => {
    expect(parseQty('5')).toBe(5);
    expect(parseQty(' 2.5 ')).toBe(2.5);
    expect(parseQty('1,200')).toBe(1200);
    expect(parseQty('.75')).toBe(0.75);
    expect(parseQty('0')).toBeNull();
    expect(parseQty('-3')).toBeNull();
    expect(parseQty('five')).toBeNull();
  });

  it('computes extended cost in CAD', () => {
    expect(extendedCost(3, 12.3456)).toBe(37.04);
    expect(extendedCost(3, null)).toBeNull();
    expect(formatCad(1234.5)).toBe('$1,234.50');
  });
});

describe('line status from what happened', () => {
  const base = { ordered: 10, cancelled: false, rfqSent: false, yardStock: 0, onPo: 0, receivedAtYard: 0, shipped: 0, receivedOnSite: 0, returned: 0 };
  it('walks through the normal flow', () => {
    expect(deriveLineStatus(base)).toBe('SUBMITTED');
    expect(deriveLineStatus({ ...base, rfqSent: true })).toBe('SENT_FOR_RFQ');
    expect(deriveLineStatus({ ...base, onPo: 10 })).toBe('ON_ORDER');
    expect(deriveLineStatus({ ...base, onPo: 10, receivedAtYard: 4 })).toBe('ON_ORDER'); // 4 of 10 delivered
    expect(deriveLineStatus({ ...base, onPo: 10, receivedAtYard: 10 })).toBe('RECEIVED_AT_YARD');
    expect(deriveLineStatus({ ...base, onPo: 10, receivedAtYard: 10, shipped: 6 })).toBe('SHIPPED_PARTIAL');
    expect(deriveLineStatus({ ...base, onPo: 10, receivedAtYard: 10, shipped: 10 })).toBe('SHIPPED');
    expect(deriveLineStatus({ ...base, shipped: 10, receivedOnSite: 10 })).toBe('RECEIVED_ON_SITE');
    expect(deriveLineStatus({ ...base, shipped: 10, receivedOnSite: 10, returned: 10 })).toBe('RETURNED');
  });
  it('yard stock covers a line fully or partly', () => {
    expect(deriveLineStatus({ ...base, yardStock: 10 })).toBe('YARD_STOCK');
    expect(deriveLineStatus({ ...base, yardStock: 6 })).toBe('SUBMITTED');
    expect(deriveLineStatus({ ...base, yardStock: 6, onPo: 4 })).toBe('ON_ORDER');
    expect(deriveLineStatus({ ...base, yardStock: 6, onPo: 4, receivedAtYard: 4 })).toBe('RECEIVED_AT_YARD');
  });
  it('cancelled wins', () => {
    expect(deriveLineStatus({ ...base, cancelled: true, onPo: 10 })).toBe('CANCELLED');
  });
  it('works out what is left to buy', () => {
    expect(qtyToProcure({ ordered: 10, cancelled: false, yardStock: 6, onPo: 0 })).toBe(4);
    expect(qtyToProcure({ ordered: 10, cancelled: false, yardStock: 6, onPo: 4 })).toBe(0);
    expect(qtyToProcure({ ordered: 0.3, cancelled: false, yardStock: 0.1, onPo: 0.1 })).toBe(0.1);
    expect(qtyToProcure({ ordered: 10, cancelled: true, yardStock: 0, onPo: 0 })).toBe(0);
  });
});
