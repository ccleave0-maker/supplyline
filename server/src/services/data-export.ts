// Full data export: everything the organization has in Bowron as one ZIP —
// a JSON file per table plus the uploaded/generated files — so a customer can
// always take their data with them. Sign-in secrets and stored keys are left out.

import JSZip from 'jszip';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { readFileAsset } from './files';

/** Files beyond this total are listed instead of included (the ZIP is built in memory). */
const MAX_FILE_BYTES = 300 * 1_048_576;

type Where = (org: string, companyIds: string[]) => Record<string, unknown>;
const byOrg: Where = (org) => ({ organizationId: org });
const byCompany: Where = (_o, c) => ({ companyId: { in: c } });
const bySite: Where = (org) => ({ site: { organizationId: org } });

/** Table → how to find this organization's rows, and fields never exported. */
const TABLES: [model: string, where: Where, omit?: string[]][] = [
  ['company', byOrg],
  ['user', byOrg],
  ['invite', byOrg],
  ['site', byOrg],
  ['yardCompany', byCompany],
  ['siteMembership', bySite],
  ['companyEmailRecipient', byCompany],
  ['siteEmailRoute', bySite],
  ['siteContact', bySite],
  ['costCode', byCompany],
  ['customColumn', byCompany],
  ['customValue', (org) => ({ orderLine: { organizationId: org } })],
  ['orderForm', byOrg],
  ['orderLine', byOrg],
  ['vendor', byCompany],
  ['purchaseOrder', byOrg],
  ['purchaseOrderLine', (org) => ({ purchaseOrder: { organizationId: org } })],
  ['yardReceipt', byOrg],
  ['yardReceiptLine', (org) => ({ yardReceipt: { organizationId: org } })],
  ['inventoryLot', byOrg],
  ['billOfLading', byOrg],
  ['bolStop', (org) => ({ bol: { organizationId: org } })],
  ['bOLLine', (org) => ({ bol: { organizationId: org } })],
  ['siteReceipt', byOrg],
  ['siteReceiptLine', (org) => ({ siteReceipt: { organizationId: org } })],
  ['siteInventoryItem', bySite],
  ['shippingLocation', byOrg],
  ['contact', byOrg],
  ['equipment', byOrg],
  ['equipmentMovement', (org) => ({ equipment: { organizationId: org } })],
  ['fileAsset', byOrg, ['storageKey']],
  ['qCDocument', byOrg],
  ['qCDocumentLine', (org) => ({ qcDocument: { organizationId: org } })],
  ['subcontractDocument', byOrg],
  ['sitePost', bySite],
  ['emailTemplate', byCompany],
  ['siteNotifyRule', bySite],
  ['emailOutbox', byOrg],
  ['auditLog', byOrg],
  ['exportMapping', byOrg],
  ['rental', byOrg],
  ['complianceRecord', byOrg],
  ['apInvoice', byOrg, ['aiRaw']],
  ['apInvoiceLine', (org) => ({ invoice: { organizationId: org } })],
  ['apApproval', (org) => ({ invoice: { organizationId: org } })],
  ['customer', byOrg],
  ['arInvoice', byOrg],
  ['arInvoiceLine', (org) => ({ invoice: { organizationId: org } })],
  ['arPayment', (org) => ({ invoice: { organizationId: org } })],
  ['subHoldback', bySite],
  ['jobBudget', bySite],
  ['aiRequestLog', byOrg],
  ['filingJob', byOrg],
  ['syncDevice', byOrg, ['tokenHash']],
];

const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').slice(0, 120);

export async function exportAllData(auth: AuthContext, opts: { includeFiles: boolean }): Promise<{ bytes: Uint8Array; fileName: string }> {
  requirePermission(auth, 'integrations:manage');
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  const companyIds = (await db.company.findMany({ where: { organizationId: auth.orgId }, select: { id: true } })).map((c) => c.id);
  const zip = new JSZip();
  const counts: Record<string, number> = {};
  const delegates = db as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>;

  for (const [model, where, omit] of TABLES) {
    const rows = await delegates[model]!.findMany({ where: where(auth.orgId, companyIds) });
    for (const r of rows) for (const f of omit ?? []) delete r[f];
    counts[model] = rows.length;
    zip.file(`data/${model}.json`, JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  }

  const notIncluded: { id: string; fileName: string; reason: string }[] = [];
  if (opts.includeFiles) {
    const files = await db.fileAsset.findMany({ where: { organizationId: auth.orgId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    let total = 0;
    for (const f of files) {
      if (total + f.sizeBytes > MAX_FILE_BYTES) {
        notIncluded.push({ id: f.id, fileName: f.fileName, reason: 'Export size limit reached' });
        continue;
      }
      try {
        const got = await readFileAsset(f.id);
        if (!got) throw new Error('missing');
        zip.file(`files/${f.kind}/${f.id}-${safe(f.fileName)}`, got.bytes);
        total += f.sizeBytes;
      } catch {
        notIncluded.push({ id: f.id, fileName: f.fileName, reason: 'Could not read the file from storage' });
      }
    }
    if (notIncluded.length) zip.file('files-not-included.json', JSON.stringify(notIncluded, null, 2));
  }

  zip.file(
    'README.txt',
    [
      `Bowron data export — ${org.name}`,
      `Made ${new Date().toISOString()} by ${auth.email}`,
      '',
      'data/   one JSON file per table (ids link the tables together)',
      opts.includeFiles ? 'files/  uploaded and generated documents, by kind, named <file id>-<name>' : 'files/  not included in this export',
      '',
      'Sign-in codes, sessions, mailbox/storage connections and stored API keys are never exported.',
      '',
      ...Object.entries(counts).map(([k, v]) => `${k}: ${v}`),
    ].join('\r\n'),
  );

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await audit(db, auth, 'org.data_export', 'Organization', auth.orgId, null, { includeFiles: opts.includeFiles, tables: Object.keys(counts).length, filesSkipped: notIncluded.length });
  return { bytes, fileName: `Bowron-export-${safe(org.name).replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.zip` };
}
