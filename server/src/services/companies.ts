import type { Role } from '@supplyline/core/models';
import type {
  BrandingImageKind,
  CompanyCreateInput,
  CompanyDetail,
  CompanyUpdateInput,
  EmailRecipientInput,
  PublicBranding,
} from '@supplyline/core/models';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { env } from '../lib/env';
import { conflict, notFound } from '../lib/errors';
import { assertCompanyAccessible } from './access';
import { saveUpload } from './files';
import { buildMe, toCompanySummary } from './me';

export async function listCompanies(auth: AuthContext) {
  return (await buildMe(auth.userId)).companies;
}

/** Roles that see prices on order lists. Default: Admin + Procurement (a job's PM always sees its prices). */
export function priceRolesOf(settings: unknown): Role[] {
  const v = (settings as { priceRoles?: unknown } | null)?.priceRoles;
  return Array.isArray(v) ? (v.filter((r) => typeof r === 'string') as Role[]) : ['ADMIN', 'PROCUREMENT'];
}

export async function getCompany(auth: AuthContext, id: string): Promise<CompanyDetail> {
  await assertCompanyAccessible(auth, id);
  const c = await db.company.findUniqueOrThrow({
    where: { id },
    include: { emailRecipients: { orderBy: [{ kind: 'asc' }, { email: 'asc' }] } },
  });
  return {
    ...toCompanySummary(c),
    emailRecipients: c.emailRecipients.map((r) => ({ id: r.id, kind: r.kind, email: r.email, name: r.name })),
    priceRoles: priceRolesOf(c.settings),
  };
}

export async function createCompany(auth: AuthContext, input: CompanyCreateInput) {
  requirePermission(auth, 'company:edit');
  const clash = await db.company.findFirst({ where: { organizationId: auth.orgId, code: input.code } });
  if (clash) throw conflict(`Company code ${input.code} is already used.`);
  return db.$transaction(async (tx) => {
    const c = await tx.company.create({ data: { ...input, organizationId: auth.orgId } });
    await audit(tx, auth, 'company.create', 'Company', c.id, null, input);
    return toCompanySummary(c);
  });
}

export async function updateCompany(auth: AuthContext, id: string, input: CompanyUpdateInput) {
  requirePermission(auth, 'company:edit');
  const before = await assertCompanyAccessible(auth, id);
  if (input.code && input.code !== before.code) {
    const clash = await db.company.findFirst({ where: { organizationId: auth.orgId, code: input.code } });
    if (clash) throw conflict(`Company code ${input.code} is already used.`);
  }
  const { priceRoles, ...fields } = input;
  const settings = priceRoles ? { ...((before.settings as Record<string, unknown>) ?? {}), priceRoles: [...new Set(priceRoles)] } : undefined;
  return db.$transaction(async (tx) => {
    const c = await tx.company.update({ where: { id }, data: { ...fields, ...(settings ? { settings } : {}) } });
    await audit(tx, auth, 'company.update', 'Company', id, { name: before.name, code: before.code, themeColor: before.themeColor }, input);
    return toCompanySummary(c);
  });
}

export async function setBrandingImage(auth: AuthContext, companyId: string, kind: BrandingImageKind, file: File | null) {
  requirePermission(auth, 'company:edit');
  await assertCompanyAccessible(auth, companyId);
  const field = kind === 'logo' ? 'logoFileId' : 'loginBackgroundFileId';
  let fileId: string | null = null;
  if (file) {
    const asset = await saveUpload({
      organizationId: auth.orgId,
      companyId,
      uploadedById: auth.userId,
      kind: kind === 'logo' ? 'LOGO' : 'BACKGROUND',
      file,
      maxBytes: kind === 'logo' ? 2 * 1_048_576 : 8 * 1_048_576,
      imagesOnly: true,
    });
    fileId = asset.id;
  }
  const c = await db.company.update({ where: { id: companyId }, data: { [field]: fileId } });
  await audit(db, auth, `company.${kind}_${file ? 'set' : 'cleared'}`, 'Company', companyId, null, { fileId });
  return toCompanySummary(c);
}

export async function addEmailRecipient(auth: AuthContext, companyId: string, input: EmailRecipientInput) {
  requirePermission(auth, 'company:edit');
  await assertCompanyAccessible(auth, companyId);
  const r = await db.companyEmailRecipient.upsert({
    where: { companyId_kind_email: { companyId, kind: input.kind, email: input.email } },
    create: { companyId, kind: input.kind, email: input.email, name: input.name ?? null },
    update: { name: input.name ?? null },
  });
  await audit(db, auth, 'company.recipient_add', 'Company', companyId, null, input);
  return { id: r.id, kind: r.kind, email: r.email, name: r.name };
}

export async function removeEmailRecipient(auth: AuthContext, companyId: string, recipientId: string) {
  requirePermission(auth, 'company:edit');
  await assertCompanyAccessible(auth, companyId);
  const r = await db.companyEmailRecipient.findFirst({ where: { id: recipientId, companyId } });
  if (!r) throw notFound('Email recipient');
  await db.companyEmailRecipient.delete({ where: { id: r.id } });
  await audit(db, auth, 'company.recipient_remove', 'Company', companyId, { kind: r.kind, email: r.email }, null);
}

/** Login-screen branding for the company last used on this device (no login needed). */
export async function publicBranding(companyId: string | null): Promise<PublicBranding> {
  const c = companyId ? await db.company.findUnique({ where: { id: companyId } }) : null;
  return { company: c ? toCompanySummary(c) : null, googleClientId: env().GOOGLE_CLIENT_ID || null };
}
