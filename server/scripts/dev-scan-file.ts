// Dev helper: run a photo through the BOL scanner as a given user.
// Run: tsx --env-file=.env scripts/dev-scan-file.ts <email> <image path>
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { AuthContext } from '../src/lib/auth';
import { db } from '../src/lib/db';
import { scanDocument } from '../src/services/scan';

async function main() {
  const [email, path] = process.argv.slice(2);
  const user = await db.user.findFirstOrThrow({ where: { email: email!.toLowerCase() } });
  const auth: AuthContext = { sessionId: 'dev', userId: user.id, orgId: user.organizationId, companyId: user.companyId, email: user.email, name: user.name, roles: user.roles as AuthContext['roles'], isPlatformOwner: user.isPlatformOwner, clientApp: 'script', clientVersion: '0' };
  const file = new File([readFileSync(path!)], basename(path!), { type: 'image/jpeg' });
  console.log(JSON.stringify(await scanDocument(auth, file, 'site')));
}
main().finally(() => db.$disconnect());
