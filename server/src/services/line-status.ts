import { deriveLineStatus, deriveOrderStatus, qtyToProcure, type LineFacts, type LineStatus } from '@supplyline/core/domain';
import type { Prisma } from '../generated/prisma/client';
import type { Db, Tx } from '../lib/db';

/** What we need to load to work out a line's status. */
export const lineFactsInclude = {
  inventoryLots: { select: { source: true, qtyIn: true } },
  poLines: { where: { purchaseOrder: { status: { in: ['ISSUED', 'CLOSED'] } } }, select: { qty: true } },
  yardReceiptLines: { select: { qtyReceived: true, purchaseOrderLineId: true, bolLineId: true } },
  siteInventory: { select: { qtyShipped: true, qtyReceived: true, qtyReturned: true } },
} satisfies Prisma.OrderLineInclude;

type LineWithFacts = Prisma.OrderLineGetPayload<{ include: typeof lineFactsInclude }>;

export function lineFacts(l: LineWithFacts): LineFacts {
  const sum = (xs: { toString(): string }[]) => xs.reduce<number>((a, x) => a + Number(x), 0);
  return {
    ordered: Number(l.quantity),
    cancelled: l.cancelledAt != null || l.status === 'CANCELLED',
    rfqSent: l.rfqSentAt != null,
    yardStock: sum(l.inventoryLots.filter((i) => i.source === 'YARD_STOCK').map((i) => i.qtyIn)),
    onPo: sum(l.poLines.map((p) => p.qty)),
    receivedAtYard: sum(l.yardReceiptLines.filter((r) => r.purchaseOrderLineId && !r.bolLineId).map((r) => r.qtyReceived)),
    shipped: Number(l.siteInventory?.qtyShipped ?? 0),
    receivedOnSite: Number(l.siteInventory?.qtyReceived ?? 0),
    returned: Number(l.siteInventory?.qtyReturned ?? 0),
  };
}

export const lineToBuy = (l: LineWithFacts) => qtyToProcure(lineFacts(l));

/**
 * Re-derive the status of these lines (and their order lists) from what has
 * actually happened. Call after any change to yard stock, POs or receipts.
 */
export async function recomputeLines(tx: Tx | Db, lineIds: string[]): Promise<void> {
  if (lineIds.length === 0) return;
  const lines = await tx.orderLine.findMany({ where: { id: { in: [...new Set(lineIds)] } }, include: lineFactsInclude });
  const orderIds = new Set<string>();
  const now = new Date();
  for (const l of lines) {
    orderIds.add(l.orderFormId);
    const status = deriveLineStatus(lineFacts(l));
    if (status !== l.status) await tx.orderLine.update({ where: { id: l.id }, data: { status, statusChangedAt: now } });
  }
  for (const orderId of orderIds) {
    const statuses = await tx.orderLine.findMany({ where: { orderFormId: orderId }, select: { status: true } });
    const status = deriveOrderStatus(statuses.map((s) => s.status as LineStatus));
    await tx.orderForm.update({ where: { id: orderId }, data: { status } });
  }
}
