// Receiving reports: a PDF made on every yard receipt and site receipt. They are
// filed with the receipt (and to the network folder), shown on the vendor invoice
// for approval, and added to the approved invoice's PDF.

import { PDFDocument } from 'pdf-lib';
import { formatListLabel } from '@supplyline/core/domain';
import { renderReceivingReport } from '../pdf/receiving-report';
import { db } from '../lib/db';
import { fileUrl, logoForPdf, readFileAsset, saveUpload } from './files';
import { fileDocument, jobLabel } from './filing';

const n = (d: { toString(): string } | null | undefined) => (d == null ? 0 : Math.round(Number(d) * 1000) / 1000);
const when = (d: Date) => d.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Vancouver' });

async function company(id: string) {
  const c = await db.company.findUniqueOrThrow({ where: { id } });
  return { companyName: c.name, companyCode: c.code, themeColor: c.themeColor, logo: await logoForPdf(c.logoFileId) };
}

/** Yard receipt (a delivery from a vendor) → receiving report PDF. Never throws. */
export async function makeYardReceiptReport(receiptId: string, userId: string): Promise<string | null> {
  try {
    const r = await db.yardReceipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: {
        yard: { select: { name: true } },
        receivedBy: { select: { name: true } },
        purchaseOrder: { select: { poNumber: true, siteId: true, vendor: { select: { name: true } } } },
        photos: { where: { deletedAt: null }, select: { id: true } },
        lines: { include: { poLine: { select: { description: true, uom: true, lineNo: true, purchaseOrder: { select: { poNumber: true } } } }, orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true } } } } } } } },
      },
    });
    const bytes = await renderReceivingReport({
      ...(await company(r.companyId)),
      title: 'Receiving report',
      where: r.yard.name,
      receivedAt: when(r.receivedAt),
      receivedBy: r.receivedBy.name,
      refs: [r.purchaseOrder ? `PO ${r.purchaseOrder.poNumber}` : null, r.purchaseOrder?.vendor.name ?? null].filter((x): x is string => !!x),
      lines: r.lines.map((l) => ({
        description: l.poLine?.description ?? l.orderLine?.description ?? 'Item',
        ref: l.orderLine ? `${formatListLabel(l.orderLine.orderForm.site.jobNumber, l.orderLine.orderForm.listNo)} L${l.orderLine.lineNo}` : l.poLine ? `PO ${l.poLine.purchaseOrder.poNumber} L${l.poLine.lineNo ?? ''}` : null,
        expected: n(l.qtyExpected),
        received: n(l.qtyReceived),
        uom: l.poLine?.uom ?? l.orderLine?.uom ?? '',
        problem: l.problem ? (l.problemNote ?? 'Problem') : null,
      })),
      photos: r.photos.length,
      notes: r.notes,
    });
    const asset = await saveUpload({ organizationId: r.organizationId, companyId: r.companyId, uploadedById: userId, kind: 'DELIVERY_DOC', file: new File([new Uint8Array(bytes)], `Receiving-report-${r.purchaseOrder?.poNumber ?? receiptId.slice(-6)}-${r.receivedAt.toISOString().slice(0, 10)}.pdf`, { type: 'application/pdf' }), maxBytes: 20 * 1_048_576 });
    await db.yardReceipt.update({ where: { id: receiptId }, data: { reportFileId: asset.id } });
    await fileDocument({ companyId: r.companyId, docType: 'RECEIVING_REPORT', fileId: asset.id, vars: { job: await jobLabel(r.purchaseOrder?.siteId), vendor: r.purchaseOrder?.vendor.name } });
    return asset.id;
  } catch (e) {
    console.error('[receiving] yard report failed', e);
    return null;
  }
}

/** Site receipt (a BOL arriving) → receiving report PDF. Never throws. */
export async function makeSiteReceiptReport(receiptId: string, userId: string): Promise<string | null> {
  try {
    const r = await db.siteReceipt.findUniqueOrThrow({
      where: { id: receiptId },
      include: {
        bol: { select: { bolNumber: true, companyId: true } },
        stop: { include: { location: { select: { businessName: true } } } },
        receivedBy: { select: { name: true } },
        photos: { where: { deletedAt: null }, select: { id: true } },
        lines: { include: { bolLine: { include: { poLine: { select: { purchaseOrder: { select: { poNumber: true } } } }, orderLine: { include: { orderForm: { include: { site: { select: { jobNumber: true } } } } } } } } } },
      },
    });
    const pos = [...new Set(r.lines.map((l) => l.bolLine.poLine?.purchaseOrder.poNumber).filter((x): x is string => !!x))];
    const bytes = await renderReceivingReport({
      ...(await company(r.bol.companyId)),
      title: 'Receiving report (site)',
      where: r.stop.location.businessName,
      receivedAt: when(r.receivedAt),
      receivedBy: r.receivedBy.name,
      refs: [r.bol.bolNumber ? `BOL #${r.bol.bolNumber}` : 'BOL', ...pos.map((p) => `PO ${p}`)],
      lines: r.lines.map((l) => ({
        description: l.bolLine.description,
        ref: l.bolLine.orderLine ? `${formatListLabel(l.bolLine.orderLine.orderForm.site.jobNumber, l.bolLine.orderLine.orderForm.listNo)} L${l.bolLine.orderLine.lineNo}` : null,
        expected: n(l.qtyReceived) + n(l.qtyShort),
        received: n(l.qtyReceived),
        uom: l.bolLine.uom,
        problem: l.damaged ? (l.note ?? 'Damaged') : (l.note ?? null),
      })),
      photos: r.photos.length,
      notes: r.notes,
    });
    const asset = await saveUpload({ organizationId: r.organizationId, companyId: r.bol.companyId, uploadedById: userId, kind: 'DELIVERY_DOC', file: new File([new Uint8Array(bytes)], `Receiving-report-BOL-${r.bol.bolNumber ?? ''}-${r.receivedAt.toISOString().slice(0, 10)}.pdf`, { type: 'application/pdf' }), maxBytes: 20 * 1_048_576 });
    await db.siteReceipt.update({ where: { id: receiptId }, data: { reportFileId: asset.id } });
    await fileDocument({ companyId: r.bol.companyId, docType: 'RECEIVING_REPORT', fileId: asset.id, vars: { job: await jobLabel(r.siteId) } });
    return asset.id;
  } catch (e) {
    console.error('[receiving] site report failed', e);
    return null;
  }
}

/** Receiving reports for a PO: yard receipts of it, and site receipts of loads carrying its lines. */
export async function reportsForPo(purchaseOrderId: string): Promise<{ id: string; label: string; url: string; at: string }[]> {
  const yard = await db.yardReceipt.findMany({ where: { purchaseOrderId, reportFileId: { not: null } }, include: { yard: { select: { name: true } } }, orderBy: { receivedAt: 'asc' } });
  const site = await db.siteReceipt.findMany({ where: { reportFileId: { not: null }, lines: { some: { bolLine: { poLine: { purchaseOrderId } } } } }, include: { stop: { include: { location: { select: { businessName: true } } } } }, orderBy: { receivedAt: 'asc' } });
  return [
    ...yard.map((r) => ({ id: r.reportFileId!, label: `Received at ${r.yard.name}`, url: fileUrl(r.reportFileId)!, at: r.receivedAt.toISOString() })),
    ...site.map((r) => ({ id: r.reportFileId!, label: `Received at ${r.stop.location.businessName}`, url: fileUrl(r.reportFileId)!, at: r.receivedAt.toISOString() })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

/** The invoice PDF with its receiving reports added at the back (null if the invoice isn't a PDF or there are none). */
export async function invoiceWithReports(invoiceFileId: string, reportFileIds: string[]): Promise<Uint8Array | null> {
  if (!reportFileIds.length) return null;
  const inv = await readFileAsset(invoiceFileId);
  if (!inv) return null;
  const out = await PDFDocument.create();
  if (inv.file.mimeType === 'application/pdf') {
    const src = await PDFDocument.load(inv.bytes, { ignoreEncryption: true });
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  } else if (inv.file.mimeType === 'image/jpeg' || inv.file.mimeType === 'image/png') {
    // A photographed invoice becomes the first page.
    const img = inv.file.mimeType === 'image/png' ? await out.embedPng(inv.bytes) : await out.embedJpg(inv.bytes);
    const scale = Math.min(612 / img.width, 792 / img.height, 1);
    const page = out.addPage([612, 792]);
    page.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  } else return null;
  for (const id of reportFileIds) {
    const r = await readFileAsset(id);
    if (!r) continue;
    const src = await PDFDocument.load(r.bytes);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return out.save();
}
