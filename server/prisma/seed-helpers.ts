import { readdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { initialsFromName } from '@supplyline/core/domain';
import type { Role } from '@supplyline/core/models';
import { db } from '../src/lib/db';
import { syncShippingLocation } from '../src/services/sites';
import { saveUpload } from '../src/services/files';

export async function upsertCompany(orgId: string, c: { code: string; name: string; themeColor: string }) {
  return db.company.upsert({
    where: { organizationId_code: { organizationId: orgId, code: c.code } },
    create: { organizationId: orgId, ...c },
    update: { name: c.name, themeColor: c.themeColor },
  });
}

export async function upsertUser(
  orgId: string,
  u: { email: string; name: string; roles: Role[]; companyId: string | null; isPlatformOwner?: boolean },
) {
  const email = u.email.trim().toLowerCase();
  return db.user.upsert({
    where: { email },
    create: {
      organizationId: orgId,
      email,
      name: u.name,
      initials: initialsFromName(u.name),
      roles: u.roles,
      companyId: u.companyId,
      isPlatformOwner: u.isPlatformOwner ?? false,
    },
    update: { roles: u.roles, companyId: u.companyId, isPlatformOwner: u.isPlatformOwner ?? false, active: true },
  });
}

export async function upsertSite(
  orgId: string,
  s: {
    type: 'JOB' | 'YARD';
    companyId: string | null;
    jobNumber: string;
    name: string;
    address?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    lat?: number;
    lng?: number;
    yardCompanyIds?: string[];
  },
) {
  const existing = await db.site.findFirst({
    where: { organizationId: orgId, type: s.type, jobNumber: s.jobNumber, ...(s.type === 'JOB' ? { companyId: s.companyId } : {}) },
  });
  return db.$transaction(async (tx) => {
    const data = {
      name: s.name,
      address: s.address ?? null,
      city: s.city ?? null,
      province: s.province ?? null,
      postalCode: s.postalCode ?? null,
      lat: s.lat ?? null,
      lng: s.lng ?? null,
    };
    const site = existing
      ? await tx.site.update({ where: { id: existing.id }, data })
      : await tx.site.create({ data: { ...data, organizationId: orgId, type: s.type, companyId: s.companyId, jobNumber: s.jobNumber } });
    if (s.type === 'YARD' && s.yardCompanyIds) {
      await tx.yardCompany.deleteMany({ where: { yardId: site.id } });
      await tx.yardCompany.createMany({ data: s.yardCompanyIds.map((companyId) => ({ yardId: site.id, companyId })) });
    }
    await syncShippingLocation(tx, site.id);
    return site;
  });
}

export async function addMember(siteId: string, userId: string) {
  await db.siteMembership.upsert({
    where: { siteId_userId: { siteId, userId } },
    create: { siteId, userId },
    update: {},
  });
}

export async function addRecipient(companyId: string, kind: 'PROCUREMENT' | 'YARD' | 'CC', email: string) {
  await db.companyEmailRecipient.upsert({
    where: { companyId_kind_email: { companyId, kind, email: email.toLowerCase() } },
    create: { companyId, kind, email: email.toLowerCase() },
    update: {},
  });
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

/** Loads <dir>/<CODE>-logo.* and <dir>/<CODE>-background.* if present. */
export async function attachBrandingImages(orgId: string, ownerId: string, company: { id: string; code: string }, dir: string) {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const slot of ['logo', 'background'] as const) {
    const match = names.find((n) => n.toLowerCase().startsWith(`${company.code.toLowerCase()}-${slot}.`));
    if (!match) continue;
    const mime = MIME[path.extname(match).toLowerCase()];
    if (!mime) continue;
    const bytes = await readFile(path.join(dir, match));
    const asset = await saveUpload({
      organizationId: orgId,
      companyId: company.id,
      uploadedById: ownerId,
      kind: slot === 'logo' ? 'LOGO' : 'BACKGROUND',
      file: new File([bytes], match, { type: mime }),
      maxBytes: 8 * 1_048_576,
      imagesOnly: true,
    });
    await db.company.update({
      where: { id: company.id },
      data: slot === 'logo' ? { logoFileId: asset.id } : { loginBackgroundFileId: asset.id },
    });
    console.log(`  ${company.code}: ${slot} image loaded from ${match}`);
  }
}
