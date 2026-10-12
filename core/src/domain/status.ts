// Line status rules. Statuses move forward automatically as work happens;
// this file is the single place that decides which moves are allowed.

export const LINE_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'SENT_FOR_RFQ',
  'YARD_STOCK',
  'ON_ORDER',
  'RECEIVED_AT_YARD',
  'SHIPPED_PARTIAL',
  'SHIPPED',
  'RECEIVED_ON_SITE',
  'RETURNED',
  'CANCELLED',
] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

export const LINE_STATUS_LABELS: Record<LineStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  SENT_FOR_RFQ: 'Sent for RFQ',
  YARD_STOCK: 'Yard stock',
  ON_ORDER: 'On order',
  RECEIVED_AT_YARD: 'Received at yard',
  SHIPPED_PARTIAL: 'Shipped (partial)',
  SHIPPED: 'Shipped',
  RECEIVED_ON_SITE: 'Received on site',
  RETURNED: 'Returned',
  CANCELLED: 'Cancelled',
};

/** Order of progress, used to stop a line ever moving backwards by accident. */
const RANK: Record<LineStatus, number> = {
  DRAFT: 0,
  SUBMITTED: 1,
  SENT_FOR_RFQ: 2,
  YARD_STOCK: 2,
  ON_ORDER: 3,
  RECEIVED_AT_YARD: 4,
  SHIPPED_PARTIAL: 5,
  SHIPPED: 6,
  RECEIVED_ON_SITE: 7,
  RETURNED: 8,
  CANCELLED: 99,
};

const ALLOWED: Record<LineStatus, readonly LineStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['SENT_FOR_RFQ', 'YARD_STOCK', 'ON_ORDER', 'CANCELLED'],
  SENT_FOR_RFQ: ['ON_ORDER', 'YARD_STOCK', 'CANCELLED'],
  YARD_STOCK: ['SHIPPED_PARTIAL', 'SHIPPED', 'SENT_FOR_RFQ', 'ON_ORDER', 'CANCELLED'],
  ON_ORDER: ['RECEIVED_AT_YARD', 'SHIPPED_PARTIAL', 'CANCELLED'],
  RECEIVED_AT_YARD: ['SHIPPED_PARTIAL', 'SHIPPED'],
  SHIPPED_PARTIAL: ['SHIPPED', 'RECEIVED_ON_SITE'],
  SHIPPED: ['RECEIVED_ON_SITE'],
  RECEIVED_ON_SITE: ['RETURNED'],
  RETURNED: [],
  CANCELLED: [],
};

export function canTransition(from: LineStatus, to: LineStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}

export function assertTransition(from: LineStatus, to: LineStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`A line can't go from "${LINE_STATUS_LABELS[from]}" to "${LINE_STATUS_LABELS[to]}".`);
  }
}

/** Lines can be cancelled until anything has physically moved. */
export function canCancelLine(status: LineStatus): boolean {
  return ALLOWED[status].includes('CANCELLED');
}

export function isAhead(a: LineStatus, b: LineStatus): boolean {
  return RANK[a] > RANK[b];
}

export type OrderStatus = 'DRAFT' | 'SUBMITTED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_PROGRESS: 'In progress',
  COMPLETE: 'Complete',
  CANCELLED: 'Cancelled',
};

/** An order's status follows its lines. */
export function deriveOrderStatus(lineStatuses: LineStatus[]): OrderStatus {
  if (lineStatuses.length === 0 || lineStatuses.every((s) => s === 'DRAFT')) return 'DRAFT';
  const live = lineStatuses.filter((s) => s !== 'CANCELLED');
  if (live.length === 0) return 'CANCELLED';
  if (live.every((s) => s === 'RECEIVED_ON_SITE' || s === 'RETURNED')) return 'COMPLETE';
  if (live.every((s) => s === 'SUBMITTED')) return 'SUBMITTED';
  return 'IN_PROGRESS';
}

/** Everything that has happened to one order line, in quantities. */
export interface LineFacts {
  ordered: number;
  cancelled: boolean;
  rfqSent: boolean;
  yardStock: number;        // set aside from existing yard stock
  onPo: number;             // quantity on purchase orders
  receivedAtYard: number;   // delivered to the yard against those POs
  shipped: number;          // sent to site on BOLs
  receivedOnSite: number;
  returned: number;
}

/**
 * The line status follows from the facts, so it can never drift out of step
 * with what really happened (partial shipments, partial deliveries, etc.).
 */
export function deriveLineStatus(f: LineFacts): LineStatus {
  const eps = 1e-6;
  if (f.cancelled) return 'CANCELLED';
  if (f.returned > eps && f.returned + eps >= f.receivedOnSite) return 'RETURNED';
  if (f.receivedOnSite + eps >= f.ordered) return 'RECEIVED_ON_SITE';
  if (f.shipped + eps >= f.ordered) return 'SHIPPED';
  if (f.shipped > eps) return 'SHIPPED_PARTIAL';
  if (f.yardStock + f.receivedAtYard + eps >= f.ordered) return f.receivedAtYard > eps ? 'RECEIVED_AT_YARD' : 'YARD_STOCK';
  if (f.onPo > eps) return 'ON_ORDER';
  if (f.rfqSent) return 'SENT_FOR_RFQ';
  return 'SUBMITTED';
}

/** How much procurement still needs to buy for a line. */
export function qtyToProcure(f: Pick<LineFacts, 'ordered' | 'cancelled' | 'yardStock' | 'onPo'>): number {
  if (f.cancelled) return 0;
  return Math.max(0, Math.round((f.ordered - f.yardStock - f.onPo) * 1000) / 1000);
}
