// Job / project areas: rental tracker, QC documents (MTRs, certs),
// subcontract documents, and vendor / subcontractor compliance (WCB, insurance).

import {
  complianceState,
  worstState,
  type ComplianceInput,
  type ComplianceRecordView,
  type ComplianceState,
  type ComplianceSummary,
  type QcDocInput,
  type QcDocItem,
  type RentalInput,
  type RentalItem,
  type StoredFile,
  type SubcontractDocInput,
  type SubcontractDocItem,
} from '@supplyline/core/models';
import { formatListLabel } from '@supplyline/core/domain';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { assertSiteVisible } from './access';
import { fileUrl, saveUpload } from './files';
import { fileDocument, jobLabel } from './filing';
import { canSeeSubcontracts } from './sites';
import { moveToTrash } from './trash';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : v === null ? null : undefined);
const stored = (f: { id: string; fileName: string }): StoredFile => ({ id: f.id, fileName: f.fileName, url: fileUrl(f.id)! });
const DOC_MAX = 25 * 1_048_576;

export function todayLocal(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: env().SCHEDULE_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function jobFor(auth: AuthContext, siteId: string) {
  const site = await assertSiteVisible(auth, siteId);
  if (site.type !== 'JOB' || !site.companyId) throw badRequest('This is for jobs / projects.');
  return site as typeof site & { companyId: string };
}

// ---------------------------------------------------------------------------
// Rentals
// ---------------------------------------------------------------------------
const rentalInclude = {
  contact: { select: { id: true, name: true, businessName: true, phone: true, cell: true, email: true } },
  files: { where: { deletedAt: null }, select: { id: true, fileName: true }, orderBy: { createdAt: 'asc' as const } },
};

function toRental(r: Awaited<ReturnType<typeof loadRental>>, today: string): RentalItem {
  const off = day(r.offRentDate);
  const expected = day(r.expectedOffDate);
  return {
    id: r.id,
    siteId: r.siteId,
    description: r.description,
    unitNumber: r.unitNumber,
    company: r.contact,
    onRentDate: day(r.onRentDate),
    expectedOffDate: expected,
    offRentDate: off,
    onRent: !off,
    overdue: !off && !!expected && expected < today,
    rate: r.rate == null ? null : Number(r.rate),
    ratePer: r.ratePer,
    poNumber: r.poNumber,
    insured: r.insured,
    insuranceNotes: r.insuranceNotes,
    maintenanceNotes: r.maintenanceNotes,
    notes: r.notes,
    files: r.files.map(stored),
  };
}

async function loadRental(auth: AuthContext, id: string) {
  const r = await db.rental.findFirst({ where: { id, organizationId: auth.orgId }, include: rentalInclude });
  if (!r) throw notFound('Rental');
  await assertSiteVisible(auth, r.siteId);
  return r;
}

async function rentalData(auth: AuthContext, input: Partial<RentalInput>) {
  if (input.contactId) {
    const c = await db.contact.findFirst({ where: { id: input.contactId, organizationId: auth.orgId } });
    if (!c) throw badRequest('Pick the rental company from your contacts.');
  }
  const { onRentDate, expectedOffDate, offRentDate, ...rest } = input;
  return { ...rest, onRentDate: toDate(onRentDate), expectedOffDate: toDate(expectedOffDate), offRentDate: toDate(offRentDate) };
}

export async function listRentals(auth: AuthContext, siteId: string): Promise<RentalItem[]> {
  await jobFor(auth, siteId);
  const rows = await db.rental.findMany({ where: { siteId }, include: rentalInclude, orderBy: [{ offRentDate: { sort: 'desc', nulls: 'first' } }, { onRentDate: 'desc' }] });
  const today = todayLocal();
  return rows.map((r) => toRental(r, today));
}

export async function createRental(auth: AuthContext, siteId: string, input: RentalInput) {
  requirePermission(auth, 'rental:edit');
  const site = await jobFor(auth, siteId);
  const r = await db.rental.create({ data: { ...(await rentalData(auth, input)), organizationId: auth.orgId, companyId: site.companyId, siteId, createdById: auth.userId } as never });
  await audit(db, auth, 'rental.create', 'Rental', r.id, null, input);
  return toRental(await loadRental(auth, r.id), todayLocal());
}

export async function updateRental(auth: AuthContext, id: string, input: Partial<RentalInput>) {
  requirePermission(auth, 'rental:edit');
  const before = await loadRental(auth, id);
  await db.rental.update({ where: { id }, data: (await rentalData(auth, input)) as never });
  await audit(db, auth, 'rental.update', 'Rental', id, { description: before.description }, input);
  return toRental(await loadRental(auth, id), todayLocal());
}

export async function deleteRental(auth: AuthContext, id: string) {
  requirePermission(auth, 'rental:edit');
  const r = await loadRental(auth, id);
  const raw = await db.rental.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'RENTAL', id, `Rental: ${r.description}`, { ...raw, fileIds: r.files.map((f) => f.id) });
    await tx.fileAsset.updateMany({ where: { rentalId: id }, data: { rentalId: null } });
    await tx.rental.delete({ where: { id } });
  });
}

export async function addRentalFile(auth: AuthContext, id: string, file: File) {
  requirePermission(auth, 'rental:edit');
  const r = await loadRental(auth, id);
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: r.companyId, uploadedById: auth.userId, kind: 'RENTAL_DOC', file, maxBytes: DOC_MAX });
  await db.fileAsset.update({ where: { id: asset.id }, data: { rentalId: id } });
  await audit(db, auth, 'rental.file', 'Rental', id, null, { fileId: asset.id });
  return stored(asset);
}

// ---------------------------------------------------------------------------
// QC documents (MTRs, certificates)
// ---------------------------------------------------------------------------
const qcInclude = {
  file: { select: { id: true, fileName: true, uploadedById: true } },
  purchaseOrder: { select: { poNumber: true } },
  vendor: { select: { name: true } },
  lines: { include: { orderLine: { select: { id: true, lineNo: true, description: true, orderForm: { select: { listNo: true, site: { select: { jobNumber: true } } } } } } } },
};

async function toQc(rows: Awaited<ReturnType<typeof qcRows>>): Promise<QcDocItem[]> {
  const ids = [...new Set(rows.map((r) => r.uploadedById).filter((x): x is string => !!x))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return rows.map((q) => ({
    id: q.id,
    type: q.type,
    title: q.title,
    heatNumber: q.heatNumber,
    poNumber: q.purchaseOrder?.poNumber ?? null,
    vendorName: q.vendor?.name ?? null,
    lines: q.lines.map((l) => ({
      orderLineId: l.orderLine.id,
      label: `${formatListLabel(l.orderLine.orderForm.site.jobNumber, l.orderLine.orderForm.listNo)} L${l.orderLine.lineNo}`,
      description: l.orderLine.description,
    })),
    file: stored(q.file),
    uploadedByName: users.find((u) => u.id === q.uploadedById)?.name ?? null,
    createdAt: q.createdAt.toISOString(),
  }));
}
const qcRows = (where: object) => db.qCDocument.findMany({ where, include: qcInclude, orderBy: { createdAt: 'desc' } });

export async function listQcDocs(auth: AuthContext, siteId: string, q?: string): Promise<QcDocItem[]> {
  await jobFor(auth, siteId);
  const search = q?.trim();
  return toQc(
    await qcRows({
      siteId,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { heatNumber: { contains: search, mode: 'insensitive' } },
              { purchaseOrder: { poNumber: { contains: search, mode: 'insensitive' } } },
              { vendor: { name: { contains: search, mode: 'insensitive' } } },
              { lines: { some: { orderLine: { description: { contains: search, mode: 'insensitive' } } } } },
            ],
          }
        : {}),
    }),
  );
}

export async function uploadQcDoc(auth: AuthContext, siteId: string, input: QcDocInput, file: File): Promise<QcDocItem> {
  requirePermission(auth, 'qc:upload');
  const site = await jobFor(auth, siteId);
  const po = input.poNumber
    ? await db.purchaseOrder.findFirst({ where: { companyId: site.companyId, poNumber: { equals: input.poNumber.replace(/^PO\s*#?\s*/i, ''), mode: 'insensitive' } } })
    : null;
  if (input.poNumber && !po) throw badRequest(`PO ${input.poNumber} wasn't found for this company.`);
  const vendor = input.vendorName ? await db.vendor.findFirst({ where: { companyId: site.companyId, name: { equals: input.vendorName, mode: 'insensitive' } } }) : null;
  if (input.orderLineIds.length) {
    const ok = await db.orderLine.count({ where: { id: { in: input.orderLineIds }, siteId } });
    if (ok !== new Set(input.orderLineIds).size) throw badRequest('Some of the lines are not on this job.');
  }
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: site.companyId, uploadedById: auth.userId, kind: input.type === 'MTR' ? 'MTR' : 'CERT', file, maxBytes: DOC_MAX });
  const doc = await db.qCDocument.create({
    data: {
      organizationId: auth.orgId,
      companyId: site.companyId,
      siteId,
      type: input.type,
      title: input.title,
      heatNumber: input.heatNumber ?? null,
      fileId: asset.id,
      purchaseOrderId: po?.id ?? null,
      vendorId: vendor?.id ?? po?.vendorId ?? null,
      uploadedById: auth.userId,
      lines: { create: [...new Set(input.orderLineIds)].map((orderLineId) => ({ orderLineId })) },
    },
  });
  await audit(db, auth, 'qc.upload', 'QCDocument', doc.id, null, input);
  await fileDocument({ companyId: site.companyId, docType: 'QC_DOC', fileId: asset.id, vars: { job: await jobLabel(siteId) } });
  return (await toQc(await qcRows({ id: doc.id })))[0]!;
}

export async function deleteQcDoc(auth: AuthContext, id: string) {
  requirePermission(auth, 'qc:upload');
  const d = await db.qCDocument.findFirst({ where: { id, organizationId: auth.orgId }, include: { lines: true } });
  if (!d) throw notFound('QC document');
  if (d.siteId) await assertSiteVisible(auth, d.siteId);
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'QC_DOC', id, `QC: ${d.title}`, d);
    await tx.qCDocument.delete({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// Subcontract documents
// ---------------------------------------------------------------------------
async function subcontractGuard(auth: AuthContext, siteId: string) {
  const site = await jobFor(auth, siteId);
  if (!canSeeSubcontracts(auth, site)) throw forbidden('Subcontracts are for admins, procurement and the project manager.');
  return site;
}

export async function listSubcontractDocs(auth: AuthContext, siteId: string): Promise<SubcontractDocItem[]> {
  await subcontractGuard(auth, siteId);
  const rows = await db.subcontractDocument.findMany({ where: { siteId }, include: { file: { select: { id: true, fileName: true } } }, orderBy: [{ subcontractor: 'asc' }, { createdAt: 'desc' }] });
  return rows.map((d) => ({
    id: d.id,
    subcontractor: d.subcontractor,
    contactId: d.contactId,
    docType: d.docType,
    title: d.title,
    effectiveDate: day(d.effectiveDate),
    file: stored(d.file),
    createdAt: d.createdAt.toISOString(),
  }));
}

export async function uploadSubcontractDoc(auth: AuthContext, siteId: string, input: SubcontractDocInput, file: File) {
  const site = await subcontractGuard(auth, siteId);
  if (input.contactId && !(await db.contact.findFirst({ where: { id: input.contactId, organizationId: auth.orgId } }))) throw badRequest('Contact not found.');
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: site.companyId, uploadedById: auth.userId, kind: 'SUBCONTRACT', file, maxBytes: DOC_MAX });
  const d = await db.subcontractDocument.create({
    data: {
      organizationId: auth.orgId,
      companyId: site.companyId,
      siteId,
      subcontractor: input.subcontractor,
      contactId: input.contactId ?? null,
      docType: input.docType,
      title: input.title,
      effectiveDate: toDate(input.effectiveDate) ?? null,
      fileId: asset.id,
      uploadedById: auth.userId,
    },
  });
  await audit(db, auth, 'subcontract.upload', 'SubcontractDocument', d.id, null, input);
  await fileDocument({ companyId: site.companyId, docType: 'SUBCONTRACT', fileId: asset.id, vars: { job: await jobLabel(siteId), vendor: input.subcontractor } });
  return (await listSubcontractDocs(auth, siteId)).find((x) => x.id === d.id)!;
}

export async function deleteSubcontractDoc(auth: AuthContext, id: string) {
  const d = await db.subcontractDocument.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!d) throw notFound('Document');
  await subcontractGuard(auth, d.siteId);
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'SUBCONTRACT_DOC', id, `Subcontract: ${d.subcontractor} – ${d.title}`, d);
    await tx.subcontractDocument.delete({ where: { id } });
  });
}

// ---------------------------------------------------------------------------
// Compliance (WCB, insurance) for vendors and subcontractors
// ---------------------------------------------------------------------------
type RecordRow = Awaited<ReturnType<typeof db.complianceRecord.findMany<{ include: { file: { select: { id: true; fileName: true } } } }>>>[number];

function toRecord(r: RecordRow, today: string): ComplianceRecordView {
  return {
    id: r.id,
    contactId: r.contactId,
    kind: r.kind,
    reference: r.reference,
    provider: r.provider,
    coverage: r.coverage,
    expiresOn: day(r.expiresOn),
    notes: r.notes,
    state: complianceState(day(r.expiresOn), today),
    file: r.file ? stored(r.file) : null,
  };
}

/** Best record of a kind = the one that runs latest. */
function stateFor(records: ComplianceRecordView[], kind: 'WCB' | 'INSURANCE'): ComplianceState {
  const of = records.filter((r) => r.kind === kind);
  if (!of.length) return 'MISSING';
  const latest = of.sort((a, b) => (b.expiresOn ?? '9999').localeCompare(a.expiresOn ?? '9999'))[0]!;
  return latest.state;
}

function summarize(c: { id: string; name: string; businessName: string | null; type: string }, records: ComplianceRecordView[]): ComplianceSummary {
  const wcb = stateFor(records, 'WCB');
  const insurance = stateFor(records, 'INSURANCE');
  const pretty = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
  const latest = (k: string) => records.filter((r) => r.kind === k).sort((a, b) => (b.expiresOn ?? '9999').localeCompare(a.expiresOn ?? '9999'))[0];
  const problems: string[] = [];
  for (const [k, st, label] of [
    ['WCB', wcb, 'WCB clearance'],
    ['INSURANCE', insurance, 'Insurance certificate'],
  ] as const) {
    if (st === 'MISSING') problems.push(`No ${label.toLowerCase()} on file`);
    if (st === 'EXPIRED') problems.push(`${label} expired ${pretty(latest(k)?.expiresOn ?? null)}`);
    if (st === 'EXPIRING') problems.push(`${label} expires ${pretty(latest(k)?.expiresOn ?? null)}`);
  }
  return { contactId: c.id, name: c.name, businessName: c.businessName, type: c.type, wcb, insurance, state: worstState([wcb, insurance]), problems };
}

export async function contactCompliance(auth: AuthContext, contactId: string) {
  requirePermission(auth, 'contact:view');
  const c = await db.contact.findFirst({ where: { id: contactId, organizationId: auth.orgId } });
  if (!c) throw notFound('Contact');
  const today = todayLocal();
  const records = (await db.complianceRecord.findMany({ where: { contactId }, include: { file: { select: { id: true, fileName: true } } }, orderBy: [{ kind: 'asc' }, { expiresOn: 'desc' }] })).map((r) =>
    toRecord(r, today),
  );
  return { summary: summarize(c, records), records };
}

/** Every vendor and subcontractor with their standing (worst first). */
export async function complianceOverview(auth: AuthContext): Promise<ComplianceSummary[]> {
  requirePermission(auth, 'contact:view');
  const today = todayLocal();
  const contacts = await db.contact.findMany({
    where: { organizationId: auth.orgId, active: true, OR: [{ type: { in: ['VENDOR', 'SUBCONTRACTOR'] } }, { compliance: { some: {} } }] },
    include: { compliance: { include: { file: { select: { id: true, fileName: true } } } } },
    orderBy: [{ businessName: 'asc' }, { name: 'asc' }],
  });
  const rank: Record<ComplianceState, number> = { EXPIRED: 0, MISSING: 1, EXPIRING: 2, OK: 3 };
  return contacts.map((c) => summarize(c, c.compliance.map((r) => toRecord(r, today)))).sort((a, b) => rank[a.state] - rank[b.state]);
}

/** Warning for a vendor typed on a PO: matched through the vendor's contact, else by business name. */
export async function vendorCompliance(auth: AuthContext, companyId: string, vendorName: string): Promise<ComplianceSummary | null> {
  const name = vendorName.trim();
  if (!name) return null;
  const vendor = await db.vendor.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } } });
  const contact =
    (vendor?.contactId ? await db.contact.findFirst({ where: { id: vendor.contactId, organizationId: auth.orgId } }) : null) ??
    (await db.contact.findFirst({
      where: { organizationId: auth.orgId, active: true, OR: [{ businessName: { equals: name, mode: 'insensitive' } }, { name: { equals: name, mode: 'insensitive' } }] },
    }));
  if (!contact) return null;
  return (await contactCompliance(auth, contact.id)).summary;
}

export async function addCompliance(auth: AuthContext, contactId: string, input: ComplianceInput, file: File | null) {
  requirePermission(auth, 'compliance:edit');
  const c = await db.contact.findFirst({ where: { id: contactId, organizationId: auth.orgId } });
  if (!c) throw notFound('Contact');
  const asset = file ? await saveUpload({ organizationId: auth.orgId, companyId: c.companyId, uploadedById: auth.userId, kind: 'COMPLIANCE', file, maxBytes: DOC_MAX }) : null;
  const r = await db.complianceRecord.create({
    data: { ...input, expiresOn: toDate(input.expiresOn) ?? null, organizationId: auth.orgId, contactId, fileId: asset?.id ?? null, createdById: auth.userId },
  });
  await audit(db, auth, 'compliance.add', 'ComplianceRecord', r.id, null, input);
  return contactCompliance(auth, contactId);
}

export async function deleteCompliance(auth: AuthContext, id: string) {
  requirePermission(auth, 'compliance:edit');
  const r = await db.complianceRecord.findFirst({ where: { id, organizationId: auth.orgId }, include: { contact: { select: { name: true, businessName: true } } } });
  if (!r) throw notFound('Record');
  const { contact, ...raw } = r;
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'COMPLIANCE', id, `${r.kind === 'WCB' ? 'WCB' : 'Insurance'}: ${contact.businessName ?? contact.name}`, raw);
    await tx.complianceRecord.delete({ where: { id } });
  });
  return contactCompliance(auth, r.contactId);
}
