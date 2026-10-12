import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { processFiling } from '@/services/filing';
import { runDueHealthChecks } from '@/services/health';
import { runPoFollowUps } from '@/services/purchasing';
import { runPmWeekly, runScheduledReports } from '@/services/report-builder';
import { sendDeliveryReminders } from '@/services/schedule';
import { runSecurityAlerts } from '@/services/security';

// Called hourly by an outside scheduler (e.g. a Render cron job) with
// "Authorization: Bearer <CRON_SECRET>". Off unless CRON_SECRET is set.
export async function POST(req: Request) {
  const secret = env().CRON_SECRET;
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return Response.json({ error: { code: 'unauthorized', message: 'Not allowed.' } }, { status: 401 });
  return Response.json({ reminded: await sendDeliveryReminders(), po: await runPoFollowUps(), filing: await processFiling(), health: await runDueHealthChecks(), reports: await runScheduledReports(), pmWeekly: await runPmWeekly(), security: await runSecurityAlerts() });
}
