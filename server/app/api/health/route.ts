import { db } from '@/lib/db';

// Unversioned health check for the host (Render) — confirms the database answers.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
