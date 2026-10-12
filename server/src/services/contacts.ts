import type { Prisma } from '../generated/prisma/client';
import type { ContactInput, ContactItem, ContactType } from '@supplyline/core/models';
import { db } from '../lib/db';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { conflict, notFound } from '../lib/errors';
import { moveToTrash } from './trash';

function toItem(c: Prisma.ContactGetPayload<object>): ContactItem {
  return {
    id: c.id,
    type: c.type as ContactType,
    name: c.name,
    businessName: c.businessName,
    phone: c.phone,
    cell: c.cell,
    email: c.email,
    notes: c.notes,
    companyId: c.companyId,
    active: c.active,
    isApContact: c.isApContact,
  };
}

export async function listContacts(auth: AuthContext, filter: { q?: string; type?: ContactType; includeInactive?: boolean }) {
  requirePermission(auth, 'contact:view');
  const where: Prisma.ContactWhereInput = { organizationId: auth.orgId };
  if (!filter.includeInactive) where.active = true;
  if (filter.type) where.type = filter.type;
  if (filter.q) {
    where.OR = [
      { name: { contains: filter.q, mode: 'insensitive' } },
      { businessName: { contains: filter.q, mode: 'insensitive' } },
      { email: { contains: filter.q, mode: 'insensitive' } },
      { phone: { contains: filter.q } },
    ];
  }
  const rows = await db.contact.findMany({ where, orderBy: [{ businessName: 'asc' }, { name: 'asc' }], take: 500 });
  return rows.map(toItem);
}

async function assertCompanyInOrg(auth: AuthContext, companyId: string | null | undefined) {
  if (!companyId) return;
  const c = await db.company.findFirst({ where: { id: companyId, organizationId: auth.orgId } });
  if (!c) throw notFound('Company');
}

export async function createContact(auth: AuthContext, input: ContactInput) {
  requirePermission(auth, 'contact:edit');
  await assertCompanyInOrg(auth, input.companyId);
  return db.$transaction(async (tx) => {
    const c = await tx.contact.create({
      data: {
        organizationId: auth.orgId,
        type: input.type,
        name: input.name,
        businessName: input.businessName ?? null,
        phone: input.phone ?? null,
        cell: input.cell ?? null,
        email: input.email ?? null,
        notes: input.notes ?? null,
        companyId: input.companyId ?? null,
        active: input.active ?? true,
        isApContact: input.isApContact ?? false,
        source: 'MANUAL',
      },
    });
    await audit(tx, auth, 'contact.create', 'Contact', c.id, null, input);
    return toItem(c);
  });
}

export async function updateContact(auth: AuthContext, id: string, input: Partial<ContactInput>) {
  requirePermission(auth, 'contact:edit');
  const before = await db.contact.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!before) throw notFound('Contact');
  await assertCompanyInOrg(auth, input.companyId);
  return db.$transaction(async (tx) => {
    const c = await tx.contact.update({ where: { id }, data: input });
    await audit(tx, auth, 'contact.update', 'Contact', id, toItem(before) as unknown as Record<string, unknown>, input);
    return toItem(c);
  });
}

/** Into the recycle bin (with its job links). Contacts used on BOLs, vendors or subcontracts can only be made inactive. */
export async function deleteContact(auth: AuthContext, id: string) {
  requirePermission(auth, 'contact:edit');
  const c = await db.contact.findFirst({
    where: { id, organizationId: auth.orgId },
    include: { sites: true, compliance: true, _count: { select: { vendors: true, bolsCarried: true, subcontracts: true, rentals: true } } },
  });
  if (!c) throw notFound('Contact');
  if (c._count.vendors || c._count.bolsCarried || c._count.subcontracts || c._count.rentals) {
    throw conflict('This contact is used on BOLs, vendors, rentals or subcontracts. Untick "Active" to hide it instead.');
  }
  const { _count, ...snapshot } = c;
  await db.$transaction(async (tx) => {
    await moveToTrash(tx, auth, 'CONTACT', id, [c.businessName, c.name].filter(Boolean).join(' – '), snapshot);
    await tx.contact.delete({ where: { id } });  // job links cascade
  });
}
