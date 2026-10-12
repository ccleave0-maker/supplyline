// Import tools: bring jobs, contacts, cost codes, customers and people in from a
// spreadsheet (CSV or Excel). Preview first (we guess which column is which),
// then import with the columns the admin picked.

import { CONTACT_TYPES, IMPORT_DATASETS, ROLES, type ContactType, type GenericSheetPreview, type ImportDataset, type ImportInput, type ImportResult, type Role } from '@supplyline/core/models';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest } from '../lib/errors';
import { saveCustomer } from './accounting';
import { assertCompanyAccessible } from './access';
import { createContact, updateContact } from './contacts';
import { createCostCode } from './cost-codes';
import { parseCsv, readXlsx } from './equipment';
import { createSite, updateSite } from './sites';
import { createInvite } from './users';

/** Header names we recognise for each field (anything else the admin picks by hand). */
const GUESS: Record<string, RegExp> = {
  jobNumber: /^(job|job ?#|job ?no|job number|project ?(#|no|number)?)$/i,
  name: /^(name|job name|project name|contact|contact name|customer|customer name|full name)$/i,
  address: /^(address|street|street address)$/i,
  city: /^(city|town)$/i,
  province: /^(province|prov|state)$/i,
  postalCode: /^(postal ?code|postcode|zip)$/i,
  clientName: /^(client|owner|client ?\/ ?owner)$/i,
  startDate: /^(start|start date)$/i,
  pstExempt: /^(pst ?exempt|exempt)$/i,
  notes: /^(notes?|comments?)$/i,
  businessName: /^(business|business name|company|vendor|supplier)$/i,
  type: /^(type|category|kind)$/i,
  email: /^(e-?mail|email address)$/i,
  phone: /^(phone|office|tel|telephone)$/i,
  cell: /^(cell|mobile|cell phone)$/i,
  code: /^(code|cost code|costcode|phase)$/i,
  description: /^(desc(ription)?)$/i,
  contactName: /^(contact|contact name|attention|attn)$/i,
  termsDays: /^(terms|terms ?\(days\)|net days)$/i,
  roles: /^(roles?|access)$/i,
};

export async function previewImportSheet(auth: AuthContext, dataset: ImportDataset, file: File): Promise<GenericSheetPreview> {
  requirePermission(auth, 'integrations:manage');
  if (file.size === 0 || file.size > 10 * 1_048_576) throw badRequest('Upload a CSV or Excel file up to 10 MB.');
  const name = file.name.toLowerCase();
  let all: string[][];
  if (name.endsWith('.xlsx')) all = await readXlsx(await file.arrayBuffer());
  else if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.includes('csv')) all = parseCsv(await file.text());
  else throw badRequest('Upload a .csv or .xlsx file (in Excel: File › Save As › Excel Workbook or CSV).');
  if (all.length < 2) throw badRequest('The sheet needs a header row and at least one row of data.');
  const [headers, ...rows] = all as [string[], ...string[][]];
  if (rows.length > 5000) throw badRequest('That sheet has more than 5,000 rows. Split it into smaller files.');
  const suggested: Record<string, number> = {};
  for (const f of IMPORT_DATASETS[dataset].fields) {
    const re = GUESS[f.key];
    const i = headers.findIndex((h) => (re ? re.test(h.trim()) : h.trim().toLowerCase() === f.label.toLowerCase()));
    if (i >= 0 && !Object.values(suggested).includes(i)) suggested[f.key] = i;
  }
  return { fileName: file.name, headers, rows: rows.map((r) => headers.map((_, i) => r[i] ?? '')), suggested };
}

const yes = (v: string) => /^(y|yes|true|1|x|exempt)$/i.test(v.trim());
const n = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

/** Excel / typed dates → 2026-10-20 (or null). */
function isoDate(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    return `${y}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function contactType(v: string | undefined): ContactType {
  const t = (v ?? '').trim().toUpperCase();
  if ((CONTACT_TYPES as readonly string[]).includes(t)) return t as ContactType;
  if (/SUB/.test(t)) return 'SUBCONTRACTOR';
  if (/TRUCK|HAUL|FREIGHT/.test(t)) return 'TRUCKING';
  if (/RENT/.test(t)) return 'RENTAL';
  if (/VEND|SUPPL/.test(t)) return 'VENDOR';
  return t ? 'BUSINESS' : 'VENDOR';
}

function roles(v: string | undefined): Role[] {
  const words = (v ?? '').toUpperCase().split(/[,;/ ]+/).filter(Boolean);
  const r = words.map((w) => (w.startsWith('PROC') ? 'PROCUREMENT' : w.startsWith('ADMIN') ? 'ADMIN' : w)).filter((w): w is Role => (ROLES as readonly string[]).includes(w));
  return r.length ? [...new Set(r)] : ['SITE'];
}

export async function runImport(auth: AuthContext, input: ImportInput): Promise<ImportResult> {
  requirePermission(auth, 'integrations:manage');
  await assertCompanyAccessible(auth, input.companyId);
  const def = IMPORT_DATASETS[input.dataset];
  for (const f of def.fields) if ('required' in f && f.required && input.mapping[f.key] == null) throw badRequest(`Choose which column holds "${f.label}".`);
  const get = (r: string[], key: string) => {
    const i = input.mapping[key];
    return i == null ? undefined : (r[i] ?? '').trim();
  };
  const result: ImportResult = { created: 0, updated: 0, skipped: [] };
  const skip = (row: number, e: unknown) => result.skipped.push({ row, reason: (e as Error).message?.slice(0, 200) || 'Could not import' });

  for (let i = 0; i < input.rows.length; i++) {
    const r = input.rows[i]!;
    const rowNo = i + 2; // sheet row (after the header)
    try {
      switch (input.dataset) {
        case 'jobs': {
          const jobNumber = get(r, 'jobNumber');
          const name = get(r, 'name');
          if (!jobNumber || !name) throw new Error('Job # and name are needed');
          const fields = {
            name,
            address: n(get(r, 'address')),
            city: n(get(r, 'city')),
            province: n(get(r, 'province')),
            postalCode: n(get(r, 'postalCode')),
            clientName: n(get(r, 'clientName')),
            startDate: isoDate(get(r, 'startDate')),
            notes: n(get(r, 'notes')),
            ...(input.mapping.pstExempt != null ? { pstExempt: yes(get(r, 'pstExempt') ?? '') } : {}),
          };
          const existing = await db.site.findFirst({ where: { organizationId: auth.orgId, companyId: input.companyId, type: 'JOB', jobNumber: { equals: jobNumber, mode: 'insensitive' } } });
          if (existing) {
            if (!input.updateExisting) throw new Error(`Job ${jobNumber} is already there`);
            await updateSite(auth, existing.id, fields);
            result.updated++;
          } else {
            await createSite(auth, { type: 'JOB', companyId: input.companyId, jobNumber, ...fields });
            result.created++;
          }
          break;
        }
        case 'contacts': {
          const name = get(r, 'name');
          if (!name) throw new Error('A contact name is needed');
          const email = n(get(r, 'email'))?.toLowerCase() ?? null;
          const fields = {
            type: contactType(get(r, 'type')),
            name,
            businessName: n(get(r, 'businessName')),
            email,
            phone: n(get(r, 'phone')),
            cell: n(get(r, 'cell')),
            notes: n(get(r, 'notes')),
            companyId: input.companyId,
          };
          const existing = await db.contact.findFirst({
            where: {
              organizationId: auth.orgId,
              active: true,
              ...(email ? { email: { equals: email, mode: 'insensitive' } } : { name: { equals: name, mode: 'insensitive' }, businessName: fields.businessName ? { equals: fields.businessName, mode: 'insensitive' } : null }),
            },
          });
          if (existing) {
            if (!input.updateExisting) throw new Error(`${name} is already there`);
            await updateContact(auth, existing.id, fields);
            result.updated++;
          } else {
            await createContact(auth, fields);
            result.created++;
          }
          break;
        }
        case 'costCodes': {
          const code = get(r, 'code');
          if (!code) throw new Error('A code is needed');
          const description = n(get(r, 'description'));
          const existing = await db.costCode.findFirst({ where: { companyId: input.companyId, siteId: null, code: { equals: code, mode: 'insensitive' } } });
          if (existing?.active) {
            if (!input.updateExisting) throw new Error(`Cost code ${code} is already there`);
            await db.costCode.update({ where: { id: existing.id }, data: { description } });
            result.updated++;
          } else {
            await createCostCode(auth, input.companyId, { code, description, siteId: null });
            result.created++;
          }
          break;
        }
        case 'customers': {
          const name = get(r, 'name');
          if (!name) throw new Error('A customer name is needed');
          const terms = Number.parseInt(get(r, 'termsDays') ?? '', 10);
          const fields = {
            companyId: input.companyId,
            name,
            contactName: n(get(r, 'contactName')),
            email: n(get(r, 'email'))?.toLowerCase() ?? null,
            phone: n(get(r, 'phone')),
            address: n(get(r, 'address')),
            city: n(get(r, 'city')),
            province: n(get(r, 'province')),
            postalCode: n(get(r, 'postalCode')),
            termsDays: Number.isFinite(terms) && terms >= 0 && terms <= 180 ? terms : 30,
          };
          const existing = await db.customer.findFirst({ where: { companyId: input.companyId, name: { equals: name, mode: 'insensitive' } } });
          if (existing && !input.updateExisting) throw new Error(`${name} is already there`);
          await saveCustomer(auth, existing?.id ?? null, existing ? { ...fields, name: existing.name } : fields);
          if (existing) result.updated++;
          else result.created++;
          break;
        }
        case 'people': {
          const email = n(get(r, 'email'))?.toLowerCase();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid email is needed');
          if (await db.user.findUnique({ where: { email } })) throw new Error(`${email} already has access`);
          await createInvite(auth, { email, name: n(get(r, 'name')) ?? email.split('@')[0]!, companyId: input.companyId, roles: roles(get(r, 'roles')), siteIds: [] });
          result.created++;
          break;
        }
      }
    } catch (e) {
      skip(rowNo, e);
    }
  }
  return result;
}
