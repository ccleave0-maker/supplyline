import type { Prisma } from '../generated/prisma/client';
import type {
  ContactType,
  Role,
  SiteDetail,
  SiteEmailRouteInput,
  SiteInput,
  SiteListItem,
  SiteType,
  SiteUpdateInput,
} from '@supplyline/core/models';
import { db, type Tx } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { badRequest, conflict, notFound } from '../lib/errors';
import { taxProfile } from '@supplyline/core/domain';
import { can } from '@supplyline/core/permissions';
import { assertSiteVisible, canEditSite, siteWhereFor } from './access';
import { fileUrl, saveUpload } from './files';

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Project fields → database values (dates as Date, PM checked to be a real person in this organization). */
async function projectData(auth: AuthContext, input: { startDate?: string | null; projectManagerId?: string | null }) {
  const out: { startDate?: Date | null; projectManagerId?: string | null } = {};
  if (input.startDate !== undefined) out.startDate = input.startDate ? new Date(`${input.startDate}T00:00:00Z`) : null;
  if (input.projectManagerId !== undefined) {
    if (input.projectManagerId) {
      const pm = await db.user.findFirst({ where: { id: input.projectManagerId, organizationId: auth.orgId, active: true, deletedAt: null } });
      if (!pm) throw badRequest('Pick a project manager from your people.');
    }
    out.projectManagerId = input.projectManagerId || null;
  }
  return out;
}

/** Subcontracts: admins, procurement, and the job's own project manager. */
export function canSeeSubcontracts(auth: AuthContext, site: { projectManagerId: string | null }) {
  return can(auth, 'subcontract:manage') || site.projectManagerId === auth.userId;
}

const listInclude = {
  company: { select: { name: true } },
  yardCompanies: { select: { companyId: true } },
} satisfies Prisma.SiteInclude;

type SiteWithList = Prisma.SiteGetPayload<{ include: typeof listInclude }>;

function toListItem(s: SiteWithList): SiteListItem {
  return {
    id: s.id,
    type: s.type,
    companyId: s.companyId,
    companyName: s.company?.name ?? null,
    jobNumber: s.jobNumber,
    name: s.name,
    active: s.active,
    city: s.city,
    province: s.province,
    lat: s.lat,
    lng: s.lng,
    yardCompanyIds: s.yardCompanies.map((y) => y.companyId),
  };
}

export async function listSites(
  auth: AuthContext,
  filter: { type?: SiteType; companyId?: string; includeInactive?: boolean; q?: string },
): Promise<SiteListItem[]> {
  const and: Prisma.SiteWhereInput[] = [await siteWhereFor(auth)];
  if (filter.type) and.push({ type: filter.type });
  if (filter.companyId) {
    and.push({ OR: [{ companyId: filter.companyId }, { yardCompanies: { some: { companyId: filter.companyId } } }] });
  }
  if (!filter.includeInactive) and.push({ active: true });
  if (filter.q) {
    and.push({
      OR: [
        { jobNumber: { contains: filter.q, mode: 'insensitive' } },
        { name: { contains: filter.q, mode: 'insensitive' } },
        { city: { contains: filter.q, mode: 'insensitive' } },
      ],
    });
  }
  const sites = await db.site.findMany({ where: { AND: and }, include: listInclude, orderBy: [{ type: 'asc' }, { jobNumber: 'asc' }] });
  return sites.map(toListItem);
}

export async function getSite(auth: AuthContext, id: string): Promise<SiteDetail> {
  await assertSiteVisible(auth, id);
  const s = await db.site.findUniqueOrThrow({
    where: { id },
    include: {
      ...listInclude,
      members: { include: { user: true }, orderBy: { user: { name: 'asc' } } },
      emailRoutes: { orderBy: [{ kind: 'asc' }, { email: 'asc' }] },
      contacts: { include: { contact: true }, orderBy: { contact: { name: 'asc' } } },
      projectManager: { select: { id: true, name: true, email: true, phone: true } },
      pstExemptionFile: { select: { id: true, fileName: true } },
      _count: { select: { qcDocuments: true, subcontractDocs: true, rentals: { where: { offRentDate: null } } } },
    },
  });
  return {
    ...toListItem(s),
    address: s.address,
    postalCode: s.postalCode,
    notes: s.notes,
    clientName: s.clientName,
    startDate: dateOnly(s.startDate),
    projectManager: s.projectManager,
    pstExempt: s.pstExempt,
    pstExemptNumber: s.pstExemptNumber,
    pstExemptionFile: s.pstExemptionFile ? { id: s.pstExemptionFile.id, fileName: s.pstExemptionFile.fileName, url: fileUrl(s.pstExemptionFile.id)! } : null,
    taxLabel: taxProfile(s.province, s.pstExempt).label,
    counts: { rentalsOnRent: s._count.rentals, qcDocs: s._count.qcDocuments, subcontractDocs: s._count.subcontractDocs },
    canSeeSubcontracts: canSeeSubcontracts(auth, s),
    members: s.members
      .filter((m) => m.user.active && !m.user.deletedAt)
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        initials: m.user.initials,
        roles: m.user.roles as Role[],
      })),
    emailRoutes: s.emailRoutes.map((r) => ({ id: r.id, kind: r.kind, email: r.email, name: r.name })),
    contacts: s.contacts.map((c) => ({
      contactId: c.contactId,
      name: c.contact.name,
      businessName: c.contact.businessName,
      type: c.contact.type as ContactType,
      phone: c.contact.phone,
      cell: c.contact.cell,
      email: c.contact.email,
      roleOnSite: c.roleOnSite,
    })),
    canEdit: canEditSite(auth),
  };
}

async function validateCompanies(auth: AuthContext, ids: string[]) {
  const found = await db.company.count({ where: { id: { in: ids }, organizationId: auth.orgId } });
  if (found !== new Set(ids).size) throw badRequest('One of the selected companies was not found.');
}

function shippingLocationName(site: { type: SiteType; jobNumber: string; name: string }) {
  return site.type === 'JOB' ? `JOB#${site.jobNumber} – ${site.name}` : `${site.name} (Yard)`;
}

/** Keeps each job/yard available as a ship-to / ship-from location. */
export async function syncShippingLocation(tx: Tx, siteId: string) {
  const s = await tx.site.findUniqueOrThrow({ where: { id: siteId } });
  const data = {
    businessName: shippingLocationName(s),
    companyId: s.companyId,
    address: s.address,
    city: s.city,
    province: s.province,
    postalCode: s.postalCode,
    lat: s.lat,
    lng: s.lng,
    active: s.active,
  };
  await tx.shippingLocation.upsert({
    where: { siteId },
    create: { ...data, organizationId: s.organizationId, siteId, source: 'AUTO' },
    update: data,
  });
}

async function assertUniqueJobNumber(auth: AuthContext, type: SiteType, companyId: string | null, jobNumber: string, exceptId?: string) {
  const clash = await db.site.findFirst({
    where: {
      organizationId: auth.orgId,
      type,
      jobNumber: { equals: jobNumber, mode: 'insensitive' },
      ...(type === 'JOB' ? { companyId } : {}),
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
  });
  if (clash) throw conflict(type === 'JOB' ? `Job ${jobNumber} already exists for this company.` : `Yard code ${jobNumber} is already used.`);
}

export async function createSite(auth: AuthContext, input: SiteInput) {
  requirePermission(auth, 'site:create');
  const companyId = input.type === 'JOB' ? input.companyId! : null;
  if (companyId) await validateCompanies(auth, [companyId]);
  if (input.type === 'YARD') await validateCompanies(auth, input.yardCompanyIds ?? []);
  await assertUniqueJobNumber(auth, input.type, companyId, input.jobNumber);

  return db.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: {
        organizationId: auth.orgId,
        companyId,
        type: input.type,
        jobNumber: input.jobNumber,
        name: input.name,
        active: input.active ?? true,
        address: input.address ?? null,
        city: input.city ?? null,
        province: input.province ?? null,
        postalCode: input.postalCode ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        notes: input.notes ?? null,
        clientName: input.type === 'JOB' ? (input.clientName ?? null) : null,
        pstExempt: input.type === 'JOB' ? (input.pstExempt ?? false) : false,
        pstExemptNumber: input.type === 'JOB' ? (input.pstExemptNumber ?? null) : null,
        ...(input.type === 'JOB' ? await projectData(auth, input) : {}),
        yardCompanies:
          input.type === 'YARD' ? { create: (input.yardCompanyIds ?? []).map((cid) => ({ companyId: cid })) } : undefined,
      },
    });
    await syncShippingLocation(tx, site.id);
    await audit(tx, auth, 'site.create', 'Site', site.id, null, input);
    return { id: site.id };
  });
}

export async function updateSite(auth: AuthContext, id: string, input: SiteUpdateInput) {
  requirePermission(auth, 'site:edit');
  const before = await assertSiteVisible(auth, id);
  if (input.jobNumber && input.jobNumber !== before.jobNumber) {
    await assertUniqueJobNumber(auth, before.type, before.companyId, input.jobNumber, id);
  }
  const { yardCompanyIds, startDate, projectManagerId, ...rest } = input;
  const fields = { ...rest, ...(await projectData(auth, { startDate, projectManagerId })) };
  if (yardCompanyIds) {
    if (before.type !== 'YARD') throw badRequest('Only yards serve multiple companies.');
    if (yardCompanyIds.length === 0) throw badRequest('A yard must serve at least one company.');
    await validateCompanies(auth, yardCompanyIds);
  }
  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id }, data: fields });
    if (yardCompanyIds) {
      await tx.yardCompany.deleteMany({ where: { yardId: id } });
      await tx.yardCompany.createMany({ data: yardCompanyIds.map((companyId) => ({ yardId: id, companyId })) });
    }
    await syncShippingLocation(tx, id);
    await audit(tx, auth, 'site.update', 'Site', id, before as unknown as Record<string, unknown>, input);
  });
  return { id };
}

/** Attach (or remove) the job's PST exemption form. It goes onto every PO cut for the job (Phase 6). */
export async function setSitePstForm(auth: AuthContext, siteId: string, file: File | null) {
  requirePermission(auth, 'site:edit');
  const site = await assertSiteVisible(auth, siteId);
  if (site.type !== 'JOB') throw badRequest('PST exemption forms are for jobs / projects.');
  let fileId: string | null = null;
  if (file) {
    const asset = await saveUpload({ organizationId: auth.orgId, companyId: site.companyId, uploadedById: auth.userId, kind: 'PST_EXEMPTION', file, maxBytes: 20 * 1_048_576 });
    fileId = asset.id;
  }
  await db.$transaction(async (tx) => {
    await tx.site.update({ where: { id: siteId }, data: { pstExemptionFileId: fileId } });
    if (site.pstExemptionFileId) await tx.fileAsset.update({ where: { id: site.pstExemptionFileId }, data: { deletedAt: new Date() } });
    await audit(tx, auth, 'site.pst_form', 'Site', siteId, { fileId: site.pstExemptionFileId }, { fileId });
  });
  return { fileId, url: fileUrl(fileId) };
}

export async function setSiteMembers(auth: AuthContext, siteId: string, userIds: string[]) {
  requirePermission(auth, 'site:edit');
  await assertSiteVisible(auth, siteId);
  const valid = await db.user.findMany({
    where: { id: { in: userIds }, organizationId: auth.orgId, active: true, deletedAt: null },
    select: { id: true },
  });
  if (valid.length !== new Set(userIds).size) throw badRequest('One of the selected people was not found.');
  const before = await db.siteMembership.findMany({ where: { siteId }, select: { userId: true } });
  await db.$transaction(async (tx) => {
    await tx.siteMembership.deleteMany({ where: { siteId } });
    await tx.siteMembership.createMany({ data: valid.map((u) => ({ siteId, userId: u.id })) });
    await audit(tx, auth, 'site.members_set', 'Site', siteId, { userIds: before.map((b) => b.userId) }, { userIds });
  });
}

export async function addSiteEmailRoute(auth: AuthContext, siteId: string, input: SiteEmailRouteInput) {
  requirePermission(auth, 'site:edit');
  await assertSiteVisible(auth, siteId);
  const r = await db.siteEmailRoute.upsert({
    where: { siteId_kind_email: { siteId, kind: input.kind, email: input.email } },
    create: { siteId, kind: input.kind, email: input.email, name: input.name ?? null },
    update: { name: input.name ?? null },
  });
  await audit(db, auth, 'site.email_route_add', 'Site', siteId, null, input);
  return { id: r.id };
}

export async function removeSiteEmailRoute(auth: AuthContext, siteId: string, routeId: string) {
  requirePermission(auth, 'site:edit');
  await assertSiteVisible(auth, siteId);
  const r = await db.siteEmailRoute.findFirst({ where: { id: routeId, siteId } });
  if (!r) throw notFound('Email route');
  await db.siteEmailRoute.delete({ where: { id: r.id } });
  await audit(db, auth, 'site.email_route_remove', 'Site', siteId, { kind: r.kind, email: r.email }, null);
}

export async function setSiteContacts(
  auth: AuthContext,
  siteId: string,
  contacts: { contactId: string; roleOnSite?: string | null }[],
) {
  requirePermission(auth, 'site:edit');
  await assertSiteVisible(auth, siteId);
  const ids = contacts.map((c) => c.contactId);
  const valid = await db.contact.count({ where: { id: { in: ids }, organizationId: auth.orgId } });
  if (valid !== new Set(ids).size) throw badRequest('One of the selected contacts was not found.');
  await db.$transaction(async (tx) => {
    await tx.siteContact.deleteMany({ where: { siteId } });
    await tx.siteContact.createMany({
      data: contacts.map((c) => ({ siteId, contactId: c.contactId, roleOnSite: c.roleOnSite ?? null })),
    });
    await audit(tx, auth, 'site.contacts_set', 'Site', siteId, null, { contacts });
  });
}
