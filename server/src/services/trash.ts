// Recycle bin. Deleting a record moves a full snapshot of it (with everything
// that belonged to it) here, then removes it; Restore puts it back exactly as
// it was, with the same ids. The audit log keeps the permanent history.

import type { DeletedItem } from '@supplyline/core/models';
import { db, type Db, type Tx } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { conflict, notFound } from '../lib/errors';

export type TrashType = 'ORDER_DRAFT' | 'PO_LINE' | 'CUSTOM_COLUMN' | 'CONTACT' | 'LOCATION' | 'BOL_DRAFT' | 'RENTAL' | 'QC_DOC' | 'SUBCONTRACT_DOC' | 'COMPLIANCE';

/** JSON-safe copy (Decimal → string, Date → ISO) that Prisma accepts back on create. */
function plain<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}

export async function moveToTrash(
  tx: Tx | Db,
  auth: AuthContext,
  entityType: TrashType,
  entityId: string,
  label: string,
  snapshot: unknown,
): Promise<void> {
  await tx.deletedRecord.create({
    data: { organizationId: auth.orgId, entityType, entityId, label, snapshot: plain(snapshot) as object, deletedById: auth.userId },
  });
  await audit(tx, auth, 'record.delete', entityType, entityId, plain(snapshot) as Record<string, unknown>, null);
}

export async function listDeleted(auth: AuthContext): Promise<DeletedItem[]> {
  requirePermission(auth, 'recycle:manage');
  const rows = await db.deletedRecord.findMany({
    where: { organizationId: auth.orgId, restoredAt: null },
    orderBy: { deletedAt: 'desc' },
    take: 200,
  });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.deletedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id,
    entityType: r.entityType,
    label: r.label,
    deletedAt: r.deletedAt.toISOString(),
    deletedByName: users.find((u) => u.id === r.deletedById)?.name ?? null,
  }));
}

type Snap = Record<string, unknown> & { [k: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Put a deleted record back. Each type knows how to recreate itself. */
export async function restoreDeleted(auth: AuthContext, id: string) {
  requirePermission(auth, 'recycle:manage');
  const rec = await db.deletedRecord.findFirst({ where: { id, organizationId: auth.orgId, restoredAt: null } });
  if (!rec) throw notFound('Deleted item');
  const s = rec.snapshot as Snap;

  await db.$transaction(async (tx) => {
    switch (rec.entityType as TrashType) {
      case 'ORDER_DRAFT': {
        const { lines: _lines, ...order } = s;
        await tx.orderForm.create({ data: order as never });
        break;
      }
      case 'PO_LINE': {
        const po = await tx.purchaseOrder.findUnique({ where: { id: s.purchaseOrderId } });
        if (!po) throw conflict('The PO this line belonged to no longer exists.');
        await tx.purchaseOrderLine.create({ data: s as never });
        const { recomputeLines } = await import('./line-status');
        await recomputeLines(tx, [s.orderLineId as string]);
        break;
      }
      case 'CUSTOM_COLUMN': {
        const { values, ...col } = s;
        await tx.customColumn.create({ data: col as never });
        if (Array.isArray(values) && values.length) await tx.customValue.createMany({ data: values as never });
        break;
      }
      case 'CONTACT': {
        const { sites, compliance, ...contact } = s;
        await tx.contact.create({ data: contact as never });
        if (Array.isArray(sites) && sites.length) await tx.siteContact.createMany({ data: sites as never, skipDuplicates: true });
        if (Array.isArray(compliance) && compliance.length) await tx.complianceRecord.createMany({ data: compliance as never });
        break;
      }
      case 'RENTAL': {
        const { fileIds, ...rental } = s;
        await tx.rental.create({ data: rental as never });
        if (Array.isArray(fileIds) && fileIds.length) await tx.fileAsset.updateMany({ where: { id: { in: fileIds as string[] } }, data: { rentalId: rental.id } });
        break;
      }
      case 'QC_DOC': {
        const { lines, ...doc } = s;
        await tx.qCDocument.create({ data: doc as never });
        if (Array.isArray(lines) && lines.length) await tx.qCDocumentLine.createMany({ data: lines as never, skipDuplicates: true });
        break;
      }
      case 'SUBCONTRACT_DOC':
        await tx.subcontractDocument.create({ data: s as never });
        break;
      case 'COMPLIANCE':
        await tx.complianceRecord.create({ data: s as never });
        break;
      case 'LOCATION':
        await tx.shippingLocation.create({ data: s as never });
        break;
      case 'BOL_DRAFT': {
        const { stops, lines, ...bol } = s;
        const clash = await tx.billOfLading.findFirst({ where: { companyId: bol.companyId, bolNumber: bol.bolNumber } });
        if (clash) throw conflict('That BOL number is already in use.');
        await tx.billOfLading.create({ data: bol as never });
        if (Array.isArray(stops) && stops.length) await tx.bolStop.createMany({ data: stops as never });
        if (Array.isArray(lines) && lines.length) await tx.bOLLine.createMany({ data: lines as never });
        break;
      }
      default:
        throw conflict('This kind of record can’t be restored automatically.');
    }
    await tx.deletedRecord.update({ where: { id }, data: { restoredAt: new Date(), restoredById: auth.userId } });
    await audit(tx, auth, 'record.restore', rec.entityType, rec.entityId, null, s);
  });
  return { entityType: rec.entityType, entityId: rec.entityId };
}
