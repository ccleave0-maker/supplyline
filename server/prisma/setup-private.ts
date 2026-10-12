// Loads YOUR organization from prisma/private/my-org.json (never committed).
// Safe to run again: it updates what exists and adds what's missing.
// Drop logos/backgrounds into prisma/private/images as <CODE>-logo.png / <CODE>-background.jpg.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { addRecipient, attachBrandingImages, upsertCompany, upsertSite, upsertUser } from './seed-helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const privateDir = path.join(here, 'private');

const schema = z.object({
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

async function main() {
  const file = path.join(privateDir, 'my-org.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    console.error(`No private setup file found at ${file}\nCopy my-org.example.json to my-org.json and fill it in.`);
    process.exit(1);
  }
  const cfg = schema.parse(JSON.parse(raw));

  const org = await db.organization.upsert({
    where: { slug: cfg.organization.slug },
    create: cfg.organization,
    update: { name: cfg.organization.name },
  });
  console.log(`Organization: ${org.name}`);

  const owner = await upsertUser(org.id, {
    email: cfg.owner.email,
    name: cfg.owner.name,
    roles: ['ADMIN'],
    companyId: null,
    isPlatformOwner: true,
  });
  console.log(`Owner/admin: ${owner.email}`);

  const byCode: Record<string, string> = {};
  for (const c of cfg.companies) {
    const company = await upsertCompany(org.id, { code: c.code, name: c.name, themeColor: c.themeColor });
    byCode[c.code] = company.id;
    for (const e of c.procurementEmails) await addRecipient(company.id, 'PROCUREMENT', e);
    for (const e of c.yardEmails) await addRecipient(company.id, 'YARD', e);
    await attachBrandingImages(org.id, owner.id, company, path.join(privateDir, 'images'));
    console.log(`Company: ${c.name} (${c.code})`);
  }

  const companyId = (code: string) => {
    const id = byCode[code];
    if (!id) throw new Error(`Unknown company code "${code}" in my-org.json`);
    return id;
  };

  for (const y of cfg.yards) {
    await upsertSite(org.id, { ...y, type: 'YARD', companyId: null, jobNumber: y.code, yardCompanyIds: y.companies.map(companyId) });
    console.log(`Yard: ${y.name}`);
  }
  for (const j of cfg.sampleJobs) {
    await upsertSite(org.id, { ...j, type: 'JOB', companyId: companyId(j.company) });
    console.log(`Job: JOB#${j.jobNumber} ${j.name}`);
  }
  console.log('Done.');
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
