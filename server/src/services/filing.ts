// Network filing: every document SupplyLine makes is copied into the company's
// folders by type (e.g. P:\SupplyLine\FCP\Jobs\2249 Bridge\BOLs). The server
// writes them itself when it can reach the folder (DIRECT), or the SupplyLine
// Sync app on a PC on your network collects and writes them (SYNC).

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_FILING, filingSettingsInput, FILING_DOC_TYPES, type FilingDocType, type FilingJobView, type FilingSettings, type SyncDeviceView } from '@supplyline/core/models';
import { audit } from '../lib/audit';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest, notFound } from '../lib/errors';
import { assertCompanyAccessible } from './access';
import { fileUrl, readFileAsset } from './files';

export function filingOf(settings: unknown): FilingSettings {
  const raw = (settings as { filing?: unknown } | null)?.filing;
  const parsed = filingSettingsInput.partial().safeParse(raw ?? {});
  const v = parsed.success ? parsed.data : {};
  return { ...DEFAULT_FILING, ...v, folders: { ...DEFAULT_FILING.folders, ...(v.folders ?? {}) } } as FilingSettings;
}

export async function getFilingSettings(auth: AuthContext, companyId: string) {
  requirePermission(auth, 'integrations:manage');
  return filingOf((await assertCompanyAccessible(auth, companyId)).settings);
}

export async function saveFilingSettings(auth: AuthContext, companyId: string, input: FilingSettings) {
  requirePermission(auth, 'integrations:manage');
  const c = await assertCompanyAccessible(auth, companyId);
  if (input.enabled && input.mode === 'DIRECT' && !path.isAbsolute(input.root)) throw badRequest('Enter the full folder path, e.g. P:\\SupplyLine or \\\\server\\share\\SupplyLine.');
  if (input.enabled && input.mode === 'SYNC' && !input.root.trim()) throw badRequest('Enter the folder the Sync app should write into (a path on that PC).');
  await db.company.update({ where: { id: companyId }, data: { settings: { ...((c.settings as Record<string, unknown>) ?? {}), filing: input } } });
  await audit(db, auth, 'company.filing', 'Company', companyId, null, input);
  return input;
}

const clean = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '_';

/**
 * Queue a document for the network folders (if the company files that kind).
 * vars: job ("2249 Bridge"), vendor, etc. Never throws — filing must not break the work itself.
 */
export async function fileDocument(opts: { companyId: string; docType: FilingDocType; fileId: string; vars?: Record<string, string | null | undefined>; fileName?: string }) {
  try {
    const company = await db.company.findUnique({ where: { id: opts.companyId } });
    if (!company) return;
    const f = filingOf(company.settings);
    if (!f.enabled || !f.root || !f.types.includes(opts.docType)) return;
    const asset = await db.fileAsset.findUnique({ where: { id: opts.fileId }, select: { fileName: true } });
    if (!asset) return;
    const now = new Date();
    const vars: Record<string, string> = {
      company: company.code,
      job: 'No job',
      year: String(now.getFullYear()),
      month: String(now.getMonth() + 1).padStart(2, '0'),
      vendor: 'Vendor',
      ...Object.fromEntries(Object.entries(opts.vars ?? {}).filter(([, v]) => v)),
    } as Record<string, string>;
    const pattern = f.folders[opts.docType] || FILING_DOC_TYPES.find((d) => d.key === opts.docType)!.folder;
    const folder = pattern
      .split(/[\\/]+/)
      .map((part) => clean(part.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')))
      .filter(Boolean)
      .join('/');
    const fileName = clean((opts.fileName ?? asset.fileName).replace(/\.[^.]+$/, '')) + (path.extname(opts.fileName ?? asset.fileName) || '');
    await db.filingJob.create({ data: { organizationId: company.organizationId, companyId: company.id, docType: opts.docType, fileId: opts.fileId, relativePath: `${folder}/${fileName}`, mode: f.mode } });
  } catch (e) {
    console.error('[filing] could not queue', (e as Error).message);
  }
}

/** Write a file under the root without overwriting a different file of the same name. */
async function writeUnder(root: string, relativePath: string, bytes: Uint8Array) {
  const target = path.join(root, ...relativePath.split('/'));
  if (!path.resolve(target).startsWith(path.resolve(root))) throw new Error('Bad path');
  await fs.mkdir(path.dirname(target), { recursive: true });
  let dest = target;
  for (let i = 1; i < 100; i++) {
    try {
      const existing = await fs.readFile(dest);
      if (Buffer.compare(existing, Buffer.from(bytes)) === 0) return dest; // already there
      const ext = path.extname(target);
      dest = `${target.slice(0, -ext.length || undefined)} (${i})${ext}`;
    } catch {
      break;
    }
  }
  await fs.writeFile(dest, bytes);
  return dest;
}

/** DIRECT mode: the server writes the files itself (it can reach the folder). Run every minute. */
export async function processFiling(onlyOrgId?: string): Promise<{ done: number; failed: number }> {
  const jobs = await db.filingJob.findMany({ where: { mode: 'DIRECT', status: 'PENDING', attempts: { lt: 10 }, ...(onlyOrgId ? { organizationId: onlyOrgId } : {}) }, orderBy: { createdAt: 'asc' }, take: 200 });
  let done = 0;
  let failed = 0;
  const roots = new Map<string, string>();
  for (const j of jobs) {
    try {
      if (!roots.has(j.companyId)) {
        const c = await db.company.findUnique({ where: { id: j.companyId }, select: { settings: true } });
        roots.set(j.companyId, filingOf(c?.settings).root);
      }
      const root = roots.get(j.companyId)!;
      if (!root) throw new Error('No filing folder set');
      const f = await readFileAsset(j.fileId);
      if (!f) throw new Error('The file is gone');
      await writeUnder(root, j.relativePath, f.bytes);
      await db.filingJob.update({ where: { id: j.id }, data: { status: 'DONE', deliveredAt: new Date(), attempts: { increment: 1 }, error: null } });
      done++;
    } catch (e) {
      const attempts = j.attempts + 1;
      await db.filingJob.update({ where: { id: j.id }, data: { attempts, error: (e as Error).message.slice(0, 300), status: attempts >= 10 ? 'FAILED' : 'PENDING' } });
      failed++;
    }
  }
  return { done, failed };
}

export async function listFilingJobs(auth: AuthContext, show: 'pending' | 'failed' | 'done' = 'pending'): Promise<FilingJobView[]> {
  requirePermission(auth, 'integrations:manage');
  const rows = await db.filingJob.findMany({ where: { organizationId: auth.orgId, status: show.toUpperCase() }, orderBy: { createdAt: 'desc' }, take: 200 });
  return rows.map((j) => ({ id: j.id, docType: j.docType, relativePath: j.relativePath, mode: j.mode, status: j.status as FilingJobView['status'], attempts: j.attempts, error: j.error, createdAt: j.createdAt.toISOString(), deliveredAt: j.deliveredAt?.toISOString() ?? null }));
}

export async function retryFiling(auth: AuthContext) {
  requirePermission(auth, 'integrations:manage');
  const r = await db.filingJob.updateMany({ where: { organizationId: auth.orgId, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0 } });
  const done = await processFiling(auth.orgId);
  return { requeued: r.count, ...done };
}

// ---------------------------------------------------------------------------
// SupplyLine Sync app devices
// ---------------------------------------------------------------------------
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export async function listSyncDevices(auth: AuthContext): Promise<SyncDeviceView[]> {
  requirePermission(auth, 'integrations:manage');
  const rows = await db.syncDevice.findMany({ where: { organizationId: auth.orgId }, orderBy: { createdAt: 'desc' } });
  return rows.map((d) => ({ id: d.id, name: d.name, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, lastVersion: d.lastVersion, createdAt: d.createdAt.toISOString(), revoked: !!d.revokedAt }));
}

/** Returns the device key once (it's stored hashed). */
export async function createSyncDevice(auth: AuthContext, name: string) {
  requirePermission(auth, 'integrations:manage');
  if (!name.trim()) throw badRequest('Name the PC it runs on, e.g. "Office server".');
  const token = `sls_${randomBytes(24).toString('base64url')}`;
  const d = await db.syncDevice.create({ data: { organizationId: auth.orgId, name: name.trim().slice(0, 80), tokenHash: hash(token), createdById: auth.userId } });
  await audit(db, auth, 'sync.device_create', 'SyncDevice', d.id, null, { name });
  return { id: d.id, token };
}

export async function revokeSyncDevice(auth: AuthContext, id: string) {
  requirePermission(auth, 'integrations:manage');
  const d = await db.syncDevice.findFirst({ where: { id, organizationId: auth.orgId } });
  if (!d) throw notFound('Device');
  await db.syncDevice.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit(db, auth, 'sync.device_revoke', 'SyncDevice', id, null, null);
  return { ok: true };
}

/** The Sync app's key → its organization (or null). */
export async function deviceFromRequest(req: Request) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token.startsWith('sls_')) return null;
  const d = await db.syncDevice.findUnique({ where: { tokenHash: hash(token) } });
  if (!d || d.revokedAt) return null;
  await db.syncDevice.update({ where: { id: d.id }, data: { lastSeenAt: new Date(), lastVersion: req.headers.get('x-sync-version')?.slice(0, 40) ?? d.lastVersion } });
  return d;
}

/** What the Sync app should do: where to file, and which AP folders to watch, per company. */
export async function syncConfig(orgId: string) {
  const companies = await db.company.findMany({ where: { organizationId: orgId }, select: { id: true, code: true, name: true, settings: true } });
  const { accountingOf } = await import('./ap');
  return {
    companies: companies.map((c) => {
      const f = filingOf(c.settings);
      const a = accountingOf(c.settings);
      return { id: c.id, code: c.code, name: c.name, filing: f.enabled && f.mode === 'SYNC' ? { root: f.root } : null, apFolders: f.mode === 'SYNC' ? a.folders : null };
    }),
  };
}

/** Files waiting for the Sync app (with a short-lived download link each). */
export async function syncPending(orgId: string) {
  const jobs = await db.filingJob.findMany({ where: { organizationId: orgId, mode: 'SYNC', status: 'PENDING', attempts: { lt: 10 } }, orderBy: { createdAt: 'asc' }, take: 50 });
  return jobs.map((j) => ({ id: j.id, companyId: j.companyId, relativePath: j.relativePath, url: fileUrl(j.fileId) }));
}

export async function syncAck(orgId: string, id: string, ok: boolean, error?: string) {
  const j = await db.filingJob.findFirst({ where: { id, organizationId: orgId } });
  if (!j) throw notFound('Job');
  if (ok) await db.filingJob.update({ where: { id }, data: { status: 'DONE', deliveredAt: new Date(), attempts: { increment: 1 }, error: null } });
  else {
    const attempts = j.attempts + 1;
    await db.filingJob.update({ where: { id }, data: { attempts, error: (error ?? 'Sync app could not write it').slice(0, 300), status: attempts >= 10 ? 'FAILED' : 'PENDING' } });
  }
  return { ok: true };
}

/** "2249 Bridge Replacement" for folder names. */
export async function jobLabel(siteId: string | null | undefined) {
  if (!siteId) return null;
  const s = await db.site.findUnique({ where: { id: siteId }, select: { jobNumber: true, name: true, type: true } });
  return s ? (s.type === 'JOB' ? `${s.jobNumber} ${s.name}` : s.name) : null;
}

// ---------------------------------------------------------------------------
// AP inbox folders on your network, through the Sync app
// ---------------------------------------------------------------------------
const AP_TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** The Sync app found a new invoice in a company's AP inbox folder. */
export async function syncApUpload(orgId: string, companyId: string, sourcePath: string, file: File) {
  const company = await db.company.findFirst({ where: { id: companyId, organizationId: orgId } });
  if (!company) throw notFound('Company');
  const ext = path.extname(file.name).toLowerCase();
  if (!AP_TYPES[ext]) throw badRequest('Only PDF and image invoices are brought in.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sum = createHash('sha256').update(bytes).digest('hex');
  const dup = await db.fileAsset.findFirst({ where: { organizationId: orgId, companyId, kind: 'AP_INVOICE', checksum: sum, deletedAt: null }, select: { id: true } });
  if (dup) return { id: (await db.apInvoice.findFirst({ where: { fileId: dup.id }, select: { id: true } }))?.id ?? null, duplicate: true };
  const { systemAuth } = await import('./ap-folders');
  const auth = await systemAuth(orgId);
  if (!auth) throw badRequest('This organization has no active admin to act for the network folder.');
  const { receiveInvoice } = await import('./ap');
  const inv = await receiveInvoice({ ...auth, name: 'Sync app' }, companyId, new File([bytes], file.name, { type: AP_TYPES[ext] }), { via: 'SYNC', sourcePath: sourcePath.slice(0, 500) });
  return { id: inv.id, duplicate: false };
}

/** Invoice files the Sync app should move to another folder (they changed status). */
export async function syncApMoves(orgId: string) {
  const { accountingOf, folderStateFor, FOLDER_FOR } = await import('./ap');
  const rows = await db.apInvoice.findMany({ where: { organizationId: orgId, receivedVia: 'SYNC', sourcePath: { not: null } }, select: { id: true, companyId: true, status: true, sourcePath: true, folderState: true }, orderBy: { updatedAt: 'desc' }, take: 500 });
  const settings = new Map<string, ReturnType<typeof accountingOf>>();
  const out: { id: string; from: string; toFolder: string; state: string }[] = [];
  for (const r of rows) {
    const want = folderStateFor(r.status);
    if (r.folderState === want) continue;
    if (!settings.has(r.companyId)) settings.set(r.companyId, accountingOf((await db.company.findUnique({ where: { id: r.companyId }, select: { settings: true } }))?.settings));
    const key = FOLDER_FOR[want];
    const dir = key ? settings.get(r.companyId)!.folders[key] : '';
    if (!dir) continue;
    out.push({ id: r.id, from: r.sourcePath!, toFolder: dir, state: want });
  }
  return out;
}

/** The Sync app moved the file (newPath is where it is now). */
export async function syncApMoved(orgId: string, id: string, state: string, newPath: string) {
  const inv = await db.apInvoice.findFirst({ where: { id, organizationId: orgId, receivedVia: 'SYNC' } });
  if (!inv) throw notFound('Invoice');
  await db.apInvoice.update({ where: { id }, data: { sourcePath: newPath.slice(0, 500), folderState: state.slice(0, 20) } });
  return { ok: true };
}
