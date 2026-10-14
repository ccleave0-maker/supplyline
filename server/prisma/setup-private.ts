// Loads YOUR organization from prisma/private/my-org.json (never committed).
// Safe to run again: it updates what exists and adds what's missing.
// Drop logos/backgrounds into prisma/private/images as <CODE>-logo.png / <CODE>-background.jpg.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/lib/db';
import { orgSetupSchema, runOrgSetup } from '../src/services/platform-setup';

const here = path.dirname(fileURLToPath(import.meta.url));
const privateDir = path.join(here, 'private');

async function main() {
  const file = path.join(privateDir, 'my-org.json');
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    console.error(`No private setup file found at ${file}\nCopy my-org.example.json to my-org.json and fill it in.`);
    process.exit(1);
  }
  for (const line of await runOrgSetup(orgSetupSchema.parse(JSON.parse(raw)), path.join(privateDir, 'images'))) console.log(line);
  console.log('Done.');
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
