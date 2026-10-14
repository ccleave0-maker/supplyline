import { timingSafeEqual } from 'node:crypto';
import { db } from '@/lib/db';
import { orgSetupSchema, runOrgSetup } from '@/services/platform-setup';

// One-time setup for a brand-new hosted server: loads the owner's organization (the
// private my-org.json, sent from the owner's PC) into an EMPTY database.
// Off unless SETUP_TOKEN (32+ characters) is set on the server; refuses once any
// organization exists. Remove SETUP_TOKEN after use.
export async function POST(req: Request) {
  const expected = process.env.SETUP_TOKEN ?? '';
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const ok = expected.length >= 32 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 });
  if ((await db.organization.count()) > 0) return Response.json({ error: 'Already set up — this only works on an empty database.' }, { status: 409 });
  const parsed = orgSetupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'That isn’t a valid my-org.json.', issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  return Response.json({ ok: true, done: await runOrgSetup(parsed.data) });
}
