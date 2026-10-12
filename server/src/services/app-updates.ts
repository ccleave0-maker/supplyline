// PC app auto-update: the platform owner publishes a signed Windows installer
// (made by "pnpm desktop:build" with the update-signing key), and every installed
// SupplyLine PC app picks it up from here.

import { compareVersions } from '@supplyline/core/domain';
import { requirePermission, type AuthContext } from '../lib/auth';
import { db } from '../lib/db';
import { badRequest } from '../lib/errors';
import { fileUrl, saveUpload } from './files';

const KEY = 'desktopRelease:windows-x86_64';
type Release = { version: string; notes: string; pubDate: string; fileId: string; signature: string };

export async function publishDesktopRelease(auth: AuthContext, input: { version: string; notes: string }, installer: File, signature: string) {
  requirePermission(auth, 'platform:manage');
  if (!/^\d+\.\d+\.\d+$/.test(input.version)) throw badRequest('Version looks like 0.2.0');
  if (!/\.exe$/i.test(installer.name)) throw badRequest('Upload the …-setup.exe installer.');
  if (signature.trim().length < 50) throw badRequest('Paste the contents of the matching .sig file.');
  const asset = await saveUpload({ organizationId: auth.orgId, companyId: null, uploadedById: auth.userId, kind: 'OTHER', file: installer, maxBytes: 200 * 1_048_576 });
  const value: Release = { version: input.version, notes: input.notes.slice(0, 2000), pubDate: new Date().toISOString(), fileId: asset.id, signature: signature.trim() };
  await db.platformSetting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
  return { ok: true, version: value.version };
}

export async function currentDesktopRelease() {
  const row = await db.platformSetting.findUnique({ where: { key: KEY } });
  return (row?.value as Release | null) ?? null;
}

/** What the PC app's updater asks: null = you're up to date. */
export async function updateFor(target: string, arch: string, current: string, origin: string) {
  if (target !== 'windows' || arch !== 'x86_64') return null;
  const r = await currentDesktopRelease();
  if (!r || compareVersions(r.version, current) <= 0) return null;
  return { version: r.version, notes: r.notes, pub_date: r.pubDate, url: `${origin}${fileUrl(r.fileId)}`, signature: r.signature };
}
