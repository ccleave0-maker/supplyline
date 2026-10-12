// "Ship via" on POs: the carriers we ship with, each with our account number.

import type { ShipViaInput, ShipViaView } from '@supplyline/core/models';
import type { Prisma } from '../generated/prisma/client';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';

const view = (s: Prisma.ShipViaGetPayload<object>): ShipViaView => ({ id: s.id, name: s.name, accountNumber: s.accountNumber, phone: s.phone, email: s.email, contactId: s.contactId, companyId: s.companyId, notes: s.notes, active: s.active });

export async function listShipVia(auth: AuthContext, f: { companyId?: string; includeInactive?: boolean } = {}): Promise<ShipViaView[]> {
  requirePermission(auth, 'po:view');
  const rows = await db.shipVia.findMany({
    where: { organizationId: auth.orgId, ...(f.includeInactive ? {} : { active: true }), ...(f.companyId ? { OR: [{ companyId: null }, { companyId: f.companyId }] } : {}) },
    orderBy: { name: 'asc' },
  });
  return rows.map(view);
}

export async function saveShipVia(auth: AuthContext, id: string | null, input: ShipViaInput): Promise<ShipViaView> {
  requirePermission(auth, 'procurement:work');
  if (input.contactId && !(await db.contact.findFirst({ where: { id: input.contactId, organizationId: auth.orgId } }))) throw badRequest('Contact not found.');
  if (input.companyId && !(await db.company.findFirst({ where: { id: input.companyId, organizationId: auth.orgId } }))) throw badRequest('Company not found.');
  const data = { name: input.name, accountNumber: input.accountNumber ?? null, phone: input.phone ?? null, email: input.email || null, contactId: input.contactId ?? null, companyId: input.companyId ?? null, notes: input.notes ?? null, ...(input.active !== undefined ? { active: input.active } : {}) };
  let row;
  if (id) {
    if (!(await db.shipVia.findFirst({ where: { id, organizationId: auth.orgId } }))) throw notFound('Carrier');
    row = await db.shipVia.update({ where: { id }, data });
  } else row = await db.shipVia.create({ data: { organizationId: auth.orgId, ...data } });
  await audit(db, auth, id ? 'ship_via.update' : 'ship_via.create', 'ShipVia', row.id, null, input);
  return view(row);
}
