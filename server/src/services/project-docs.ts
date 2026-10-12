// Project documents: files attached to a job once (drawings, the subcontract
// agreement…), then picked per PO. They show on the PO by their link name and
// are added at the end of the PO PDF.

import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib';
import type { ProjectDocumentView } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { signFilePath } from '../lib/crypto';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, notFound } from '../lib/errors';
import { assertSiteVisible } from './access';
import { fileUrl, readFileAsset, saveUpload } from './files';

export async function listProjectDocuments(auth: AuthContext, siteId: string): Promise<ProjectDocumentView[]> {
  await assertSiteVisible(auth, siteId);
  const docs = await db.projectDocument.findMany({ where: { siteId, organizationId: auth.orgId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { purchaseOrders: true } } } });
  const files = new Map((await db.fileAsset.findMany({ where: { id: { in: docs.map((d) => d.fileId) } }, select: { id: true, fileName: true, mimeType: true, sizeBytes: true } })).map((f) => [f.id, f]));
  return docs.map((d) => ({ id: d.id, linkName: d.linkName, fileName: files.get(d.fileId)?.fileName ?? '', mimeType: files.get(d.fileId)?.mimeType ?? '', sizeBytes: files.get(d.fileId)?.sizeBytes ?? 0, url: fileUrl(d.fileId)!, onPos: d._count.purchaseOrders, createdAt: d.createdAt.toISOString() }));
}

export async function addProjectDocument(auth: AuthContext, siteId: string, file: File, linkName: string | null) {
  requirePermission(auth, 'site:edit');
  const site = await assertSiteVisible(auth, siteId);
  if (site.type !== 'JOB') throw badRequest('Documents are attached to jobs / projects.');
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: site.companyId, uploadedById: auth.userId, kind: 'PROJECT_DOC', file, maxBytes: 50 * 1_048_576 });
  const name = (linkName?.trim() || file.name.replace(/\.[a-z0-9]+$/i, '')).slice(0, 120);
  const d = await db.projectDocument.create({ data: { organizationId: auth.orgId, siteId, fileId: asset.id, linkName: name, createdById: auth.userId } });
  await audit(db, auth, 'project_doc.add', 'Site', siteId, null, { linkName: name, fileName: file.name });
  return { id: d.id };
}

async function loadDoc(auth: AuthContext, id: string) {
  const d = await db.projectDocument.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!d) throw notFound('Document');
  await assertSiteVisible(auth, d.siteId);
  return d;
}

export async function renameProjectDocument(auth: AuthContext, id: string, linkName: string) {
  requirePermission(auth, 'site:edit');
  const d = await loadDoc(auth, id);
  const name = linkName.trim().slice(0, 120);
  if (!name) throw badRequest('Give it a link name.');
  await db.projectDocument.update({ where: { id }, data: { linkName: name } });
  await audit(db, auth, 'project_doc.rename', 'Site', d.siteId, { linkName: d.linkName }, { linkName: name });
  return { ok: true };
}

export async function removeProjectDocument(auth: AuthContext, id: string) {
  requirePermission(auth, 'site:edit');
  const d = await loadDoc(auth, id);
  await db.$transaction([db.projectDocument.delete({ where: { id } }), db.fileAsset.update({ where: { id: d.fileId }, data: { deletedAt: new Date() } })]);
  await audit(db, auth, 'project_doc.remove', 'Site', d.siteId, { linkName: d.linkName }, null);
  return { ok: true };
}

/** Pick which of the job's documents go with this PO. */
export async function setPoDocuments(poId: string, siteId: string | null, documentIds: string[]) {
  const ids = [...new Set(documentIds)];
  if (ids.length && !siteId) throw badRequest('Project documents go on job POs.');
  if (ids.length && (await db.projectDocument.count({ where: { id: { in: ids }, siteId: siteId! } })) !== ids.length) throw badRequest('Pick documents from this job.');
  await db.purchaseOrderDocument.deleteMany({ where: { purchaseOrderId: poId, projectDocumentId: { notIn: ids } } });
  for (const id of ids) await db.purchaseOrderDocument.upsert({ where: { purchaseOrderId_projectDocumentId: { purchaseOrderId: poId, projectDocumentId: id } }, create: { purchaseOrderId: poId, projectDocumentId: id }, update: {} });
}

export async function poDocuments(poId: string) {
  const rows = await db.purchaseOrderDocument.findMany({ where: { purchaseOrderId: poId }, include: { projectDocument: true }, orderBy: { addedAt: 'asc' } });
  return rows.map((r) => ({ id: r.projectDocument.id, linkName: r.projectDocument.linkName, fileId: r.projectDocument.fileId, url: fileUrl(r.projectDocument.fileId)! }));
}

/** A link anyone with the PO can open (90 days), for the PDF. */
const publicLink = (fileId: string) => `${env().APP_URL.replace(/\/$/, '')}${signFilePath(fileId, 90 * 86_400)}`;

/**
 * Add the PO's documents at the end of its PDF: a page listing them by link name
 * (clickable), then each PDF's pages and each picture as a page.
 */
export async function appendPoDocuments(pdf: Uint8Array, poId: string): Promise<Uint8Array> {
  const docs = await poDocuments(poId);
  if (!docs.length) return pdf;
  const out = await PDFDocument.load(pdf);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const page = out.addPage([612, 792]);
  page.drawText('Attached documents', { x: 50, y: 730, size: 16, font: bold });
  let y = 700;
  const annots = [];
  for (const d of docs) {
    const text = `• ${d.linkName}`;
    page.drawText(text, { x: 60, y, size: 12, font, color: rgb(0.1, 0.3, 0.7) });
    const w = font.widthOfTextAtSize(text, 12);
    annots.push(out.context.register(out.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, y - 2, 60 + w, y + 12], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(publicLink(d.fileId)) } })));
    y -= 22;
    if (y < 60) break;
  }
  page.node.set(PDFName.of('Annots'), out.context.obj(annots));
  for (const d of docs) {
    const f = await readFileAsset(d.fileId).catch(() => null);
    if (!f) continue;
    try {
      if (f.file.mimeType === 'application/pdf') {
        const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
        for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      } else if (f.file.mimeType === 'image/png' || f.file.mimeType === 'image/jpeg') {
        const img = f.file.mimeType === 'image/png' ? await out.embedPng(f.bytes) : await out.embedJpg(f.bytes);
        const scale = Math.min(532 / img.width, 692 / img.height, 1);
        const p = out.addPage([612, 792]);
        p.drawText(d.linkName, { x: 40, y: 760, size: 11, font: bold });
        p.drawImage(img, { x: 40, y: 740 - img.height * scale, width: img.width * scale, height: img.height * scale });
      }
      // Other file types (Word, Excel, CAD…) are reached by the link on the list page.
    } catch {
      // A damaged or protected file: the link still works.
    }
  }
  return out.save();
}
