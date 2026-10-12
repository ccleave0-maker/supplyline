// How each ordered line is moving: the BOL legs carrying it (planned, on the
// way, delivered), for the materials list and site inventory.

import type { LineShipment } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';

/** Prisma include for an OrderLine's BOL legs. */
export const shipmentInclude = {
  where: { bol: { status: { not: 'CANCELLED' as const }, direction: 'OUTBOUND' as const } },
  include: {
    bol: { select: { id: true, bolNumber: true, direction: true, status: true } },
    dropStop: { select: { plannedDate: true, plannedTime: true, completedAt: true, location: { select: { businessName: true } } } },
    siteReceiptLines: { select: { qtyReceived: true, siteReceipt: { select: { receivedAt: true } } } },
  },
} satisfies Prisma.OrderLine$bolLinesArgs;

type Leg = Prisma.BOLLineGetPayload<{ include: (typeof shipmentInclude)['include'] }>;

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

export function toShipments(legs: Leg[]): LineShipment[] {
  return legs
    .map((l): LineShipment => {
      const received = l.siteReceiptLines[0]?.siteReceipt.receivedAt ?? l.dropStop.completedAt;
      const state = l.bol.status === 'DRAFT' ? 'PLANNED' : l.siteReceiptLines.length || l.dropStop.completedAt ? 'DELIVERED' : 'ON_THE_WAY';
      return {
        state,
        bolId: l.bol.id,
        bolLabel: l.bol.bolNumber == null ? 'Planned load' : `BOL #${l.bol.bolNumber}`,
        qty: Number(l.qty),
        toName: l.dropStop.location.businessName,
        date: state === 'DELIVERED' ? day(received) : day(l.dropStop.plannedDate),
        time: state === 'DELIVERED' ? null : l.dropStop.plannedTime,
      };
    })
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}
