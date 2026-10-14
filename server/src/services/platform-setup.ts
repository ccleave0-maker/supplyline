// Loads an organization (its owner, companies, yards and sample jobs) from the private
// my-org.json. Used by `pnpm db:setup-private` on a PC, and once by the hosted server's
// one-time setup endpoint (app/api/setup) while its database is still empty.
import { z } from 'zod';
import { addRecipient, attachBrandingImages, upsertCompany, upsertSite, upsertUser } from '../../prisma/seed-helpers';
import { db } from '../lib/db';

export const orgSetupSchema = z.object({
  organization: z.object({ name: z.string().min(2), slug: z.string().regex(/^[a-z0-9-]{2,40}$/) }),
  owner: z.object({ name: z.string().min(1), email: z.string().email() }),
  companies: z.array(
    z.object({
      code: z.string().regex(/^[A-Z0-9]{2,8}$/),
      name: z.string().min(2),
      themeColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      procurementEmails: z.array(z.string().email()).default([]),
      yardEmails: z.array(z.string().email()).default([]),
    }),
  ),
  yards: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        address: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        companies: z.array(z.string()).min(1),
      }),
    )
    .default([]),
  sampleJobs: z
    .array(
      z.object({
        company: z.string(),
        jobNumber: z.string().min(1),
        name: z.string().min(1),
        city: z.string().optional(),
        province: z.string().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    )
    .default([]),
});
export type OrgSetup = z.infer<typeof orgSetupSchema>;

/** Safe to run again: updates what exists and adds what's missing. Returns what it did, line by line. */
export async function runOrgSetup(cfg: OrgSetup, imagesDir?: string): Promise<string[]> {
  const log: string[] = [];
  const org = await db.organization.upsert({ where: { slug: cfg.organization.slug }, create: cfg.organization, update: { name: cfg.organization.name } });
  log.push(`Organization: ${org.name}`);

  const owner = await upsertUser(org.id, { email: cfg.owner.email, name: cfg.owner.name, roles: ['ADMIN'], companyId: null, isPlatformOwner: true });
  log.push(`Owner/admin: ${owner.email}`);

  const byCode: Record<string, string> = {};
  for (const c of cfg.companies) {
    const company = await upsertCompany(org.id, { code: c.code, name: c.name, themeColor: c.themeColor });
    byCode[c.code] = company.id;
    for (const e of c.procurementEmails) await addRecipient(company.id, 'PROCUREMENT', e);
    for (const e of c.yardEmails) await addRecipient(company.id, 'YARD', e);
    if (imagesDir) await attachBrandingImages(org.id, owner.id, company, imagesDir);
    log.push(`Company: ${c.name} (${c.code})`);
  }

  const companyId = (code: string) => {
    const id = byCode[code];
    if (!id) throw new Error(`Unknown company code "${code}" in my-org.json`);
    return id;
  };
  for (const y of cfg.yards) {
    await upsertSite(org.id, { ...y, type: 'YARD', companyId: null, jobNumber: y.code, yardCompanyIds: y.companies.map(companyId) });
    log.push(`Yard: ${y.name}`);
  }
  for (const j of cfg.sampleJobs) {
    await upsertSite(org.id, { ...j, type: 'JOB', companyId: companyId(j.company) });
    log.push(`Job: JOB#${j.jobNumber} ${j.name}`);
  }
  return log;
}
