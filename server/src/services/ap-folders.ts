// Network folder intake for AP: invoices dropped into each company's inbox
// folder are brought in (read, matched, sent to approval) and the file moves to
// "In review", then "Approved" / "Rejected" / "On hold" as the invoice does.
// Works for any folder the server can reach (a mapped drive or \\server\share).
// When Bowron is hosted online, the Sync app does the same job on your network.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { joinIn } from '../lib/folder-path';
import { accountingOf, receiveInvoice } from './ap';
import { filingOf } from './filing';

const TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const problems = new Map<string, string>(); // organizationId → last problem
const lastScan = new Map<string, Date>();

export function folderStatus(orgId: string): string | null {
  return problems.get(orgId) ?? null;
}

/** The "network folder" acts as the first admin of the organization. */
export async function systemAuth(organizationId: string): Promise<AuthContext | null> {
  const admin = await db.user.findFirst({ where: { organizationId, active: true, deletedAt: null, roles: { has: 'ADMIN' } }, orderBy: { createdAt: 'asc' } });
  if (!admin) return null;
  return { sessionId: 'ap-folder', userId: admin.id, orgId: organizationId, companyId: admin.companyId, email: admin.email, name: 'Network folder', roles: ['ADMIN'], isPlatformOwner: false, clientApp: 'server', clientVersion: '0' };
}

/** Look in every company's AP inbox folder once. Returns how many invoices came in. */
export async function scanApFolders(onlyOrgId?: string): Promise<{ imported: number; problems: string[] }> {
  const companies = await db.company.findMany({ where: onlyOrgId ? { organizationId: onlyOrgId } : {}, select: { id: true, name: true, organizationId: true, settings: true } });
  let imported = 0;
  const found: string[] = [];
  const seenOrgs = new Set<string>();
  for (const c of companies) {
    const s = accountingOf(c.settings);
    const inbox = s.folders.inbox;
    if (!inbox) continue;
    if (filingOf(c.settings).mode === 'SYNC') continue; // the Sync app watches this one
    seenOrgs.add(c.organizationId);
    let names: string[];
    try {
      names = await fs.readdir(inbox);
    } catch (e) {
      const msg = `${c.name}: can't open the AP inbox folder ${inbox} (${(e as NodeJS.ErrnoException).code ?? 'error'}).`;
      found.push(msg);
      problems.set(c.organizationId, msg);
      continue;
    }
    const auth = await systemAuth(c.organizationId);
    if (!auth) continue;
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!TYPES[ext] || name.startsWith('~$') || name.startsWith('.')) continue;
      const full = joinIn(inbox, name);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile() || Date.now() - stat.mtimeMs < 5_000) continue; // still being copied in
        const bytes = await fs.readFile(full);
        const sum = createHash('sha256').update(bytes).digest('hex');
        const dup = await db.fileAsset.findFirst({ where: { organizationId: c.organizationId, companyId: c.id, kind: 'AP_INVOICE', checksum: sum, deletedAt: null } });
        if (dup) continue; // already brought in (it stays put until someone moves it)
        const inv = await receiveInvoice(auth, c.id, new File([new Uint8Array(bytes)], name, { type: TYPES[ext] }), { via: 'FOLDER', sourcePath: full });
        imported++;
        // Out of the inbox into "In review" (unless approval already moved it on).
        const { moveFile } = await import('./ap');
        const after = await db.apInvoice.findUnique({ where: { id: inv.id }, select: { status: true } });
        await moveFile(inv.id, after?.status === 'APPROVED' ? 'APPROVED' : after?.status === 'REJECTED' ? 'REJECTED' : 'IN_REVIEW');
      } catch (e) {
        found.push(`${c.name}: ${name} – ${(e as Error).message.slice(0, 160)}`);
      }
    }
    if (!found.some((f) => f.startsWith(`${c.name}:`))) problems.delete(c.organizationId);
    else problems.set(c.organizationId, found.filter((f) => f.startsWith(`${c.name}:`)).join(' '));
    lastScan.set(c.organizationId, new Date());
  }
  for (const org of [...problems.keys()]) if (!onlyOrgId && !seenOrgs.has(org)) problems.delete(org);
  return { imported, problems: found };
}
