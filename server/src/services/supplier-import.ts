// Supplier list import: drop an Excel / CSV of vendors (e.g. exported from Sage)
// and they become Vendor contacts, with the accounting vendor ID kept for exports.

import type { SupplierImportPreview, SupplierImportResult, SupplierRow } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest } from '../lib/errors';
import { assertCompanyAccessible } from './access';
import { parseCsv, readXlsx } from './equipment';

/** Header words for each field (Sage and most other systems' exports). */
const COLS: Record<keyof SupplierRow, RegExp[]> = {
  name: [/^(vendor|supplier)\s*name$/, /^name$/, /^(company|business)(\s*name)?$/, /^vendor$/, /^supplier$/],
  vendorId: [/^(vendor|supplier)\s*(id|#|no\.?|number|code)$/, /^(id|code)$/],
  contactName: [/^(primary\s*)?contact(\s*name)?$/, /^attention$/],
  email: [/e-?mail/],
  phone: [/^(phone|telephone|tel)(\s*(no\.?|number|1))?$/, /^(work|office|main)\s*phone$/],
  cell: [/cell|mobile/],
  address: [/^(address|street)(\s*(1|line\s*1))?$/],
  city: [/^city$/],
  province: [/^(prov(ince)?|state)$/],
  postalCode: [/postal|zip/],
  terms: [/terms/],
};
const FIELDS = Object.keys(COLS) as (keyof SupplierRow)[];
const norm = (s: string) => s.toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

async function readSheet(file: File): Promise<string[][]> {
  if (file.size === 0 || file.size > 20 * 1_048_576) throw badRequest('Upload an Excel or CSV file up to 20 MB.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.includes('csv')) return parseCsv(await file.text());
  throw badRequest('Upload a .xlsx or .csv file (older .xls: open it in Excel and Save As .xlsx).');
}

/** Find the header row and which column is which. */
export function mapSupplierSheet(all: string[][]): { rows: SupplierRow[]; columns: Partial<Record<keyof SupplierRow, string>> } {
  for (let h = 0; h < Math.min(all.length, 15); h++) {
    const head = (all[h] ?? []).map((c) => norm(String(c ?? '')));
    const at: Partial<Record<keyof SupplierRow, number>> = {};
    for (const f of FIELDS) {
      const i = head.findIndex((c, k) => c && !Object.values(at).includes(k) && COLS[f].some((r) => r.test(c)));
      if (i >= 0) at[f] = i;
    }
    if (at.name === undefined) continue;
    const rows: SupplierRow[] = [];
    for (const r of all.slice(h + 1)) {
      const get = (f: keyof SupplierRow) => (at[f] === undefined ? '' : String(r[at[f]!] ?? '').trim());
      const name = get('name');
      if (!name) continue;
      rows.push(Object.fromEntries(FIELDS.map((f) => [f, get(f) || null])) as unknown as SupplierRow);
    }
    return { rows, columns: Object.fromEntries(Object.entries(at).map(([f, i]) => [f, String(all[h]![i!] ?? '')])) };
  }
  throw badRequest('Couldn’t find a vendor / supplier name column. The first rows should have headings like “Vendor ID”, “Vendor Name”, “Email”, “Phone”.');
}

export async function previewSuppliers(auth: AuthContext, file: File): Promise<SupplierImportPreview> {
  requirePermission(auth, 'contact:edit');
  const { rows, columns } = mapSupplierSheet(await readSheet(file));
  const existing = new Set((await db.contact.findMany({ where: { organizationId: auth.orgId, type: 'VENDOR' }, select: { name: true, businessName: true } })).map((c) => norm(c.businessName ?? c.name)));
  return { columns, total: rows.length, newCount: rows.filter((r) => !existing.has(norm(r.name))).length, rows: rows.slice(0, 200) };
}

/** Add new suppliers; fill in blanks on ones already there (never overwrite what someone typed). */
export async function importSuppliers(auth: AuthContext, companyId: string, file: File): Promise<SupplierImportResult> {
  requirePermission(auth, 'contact:edit');
  await assertCompanyAccessible(auth, companyId);
  const { rows } = mapSupplierSheet(await readSheet(file));
  if (rows.length > 10_000) throw badRequest('That’s more than 10,000 suppliers — split the file.');
  const contacts = await db.contact.findMany({ where: { organizationId: auth.orgId, type: 'VENDOR' } });
  const byName = new Map(contacts.map((c) => [norm(c.businessName ?? c.name), c]));
  let created = 0;
  let updated = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const key = norm(r.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const notes = [[r.address, r.city, r.province, r.postalCode].filter(Boolean).join(', '), r.terms ? `Terms: ${r.terms}` : null].filter(Boolean).join('\n') || null;
    let contact = byName.get(key);
    if (!contact) {
      contact = await db.contact.create({ data: { organizationId: auth.orgId, companyId, type: 'VENDOR', name: r.contactName || r.name, businessName: r.name, email: r.email?.toLowerCase() ?? null, phone: r.phone, cell: r.cell, notes, source: 'IMPORT' } });
      created++;
    } else {
      const fill = { ...(!contact.email && r.email ? { email: r.email.toLowerCase() } : {}), ...(!contact.phone && r.phone ? { phone: r.phone } : {}), ...(!contact.cell && r.cell ? { cell: r.cell } : {}), ...(!contact.notes && notes ? { notes } : {}) };
      if (Object.keys(fill).length) {
        await db.contact.update({ where: { id: contact.id }, data: fill });
        updated++;
      }
    }
    // The company's vendor record (keeps the accounting vendor ID for Sage exports).
    const vendor = await db.vendor.findFirst({ where: { companyId, name: { equals: r.name, mode: 'insensitive' } } });
    if (vendor) await db.vendor.update({ where: { id: vendor.id }, data: { contactId: vendor.contactId ?? contact.id, ...(r.vendorId && !vendor.externalId ? { externalId: r.vendorId } : {}) } });
    else await db.vendor.create({ data: { companyId, name: r.name, contactId: contact.id, externalId: r.vendorId } });
  }
  await audit(db, auth, 'contacts.import_suppliers', 'Company', companyId, null, { file: file.name, rows: rows.length, created, updated });
  return { total: rows.length, created, updated, skipped: rows.length - seen.size };
}
