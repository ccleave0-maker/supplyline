// Runs once when the server starts. Every hour: tomorrow's delivery reminders to
// each job, and PO follow-ups (vendor shipping-status requests, yard "has it arrived?") (DELIVERY_REMINDERS="off" to turn it off, e.g. when
// an outside scheduler calls /api/cron/reminders instead).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV === 'test') return;
  const { env } = await import('./src/lib/env');
  if (env().DELIVERY_REMINDERS === 'off') return;
  const { sendDeliveryReminders } = await import('./src/services/schedule');
  const { runPoFollowUps } = await import('./src/services/purchasing');
  const run = () => {
    sendDeliveryReminders()
      .then((n) => n && console.log(`[reminders] sent ${n} delivery reminder(s)`))
      .catch((e) => console.error('[reminders] failed', e));
    runPoFollowUps()
      .then((r) => (r.followUps || r.prompts) && console.log(`[po] ${r.followUps} vendor follow-up(s), ${r.prompts} arrival prompt(s)`))
      .catch((e) => console.error('[po] follow-ups failed', e));
  };
  setTimeout(run, 60_000);
  setInterval(run, 60 * 60_000).unref();
  // AP: pick up invoices dropped into each company's network inbox folder.
  const { scanApFolders } = await import('./src/services/ap-folders');
  const scan = () =>
    scanApFolders()
      .then((r) => r.imported && console.log(`[ap] brought in ${r.imported} invoice(s) from the network folder`))
      .catch((e) => console.error('[ap] folder scan failed', e));
  setTimeout(scan, 30_000);
  setInterval(scan, 2 * 60_000).unref();
  // Network filing: copy new documents into each company's folders (DIRECT mode).
  const { processFiling } = await import('./src/services/filing');
  const file = () =>
    processFiling()
      .then((r) => (r.done || r.failed) && console.log(`[filing] filed ${r.done}, ${r.failed} waiting to retry`))
      .catch((e) => console.error('[filing] failed', e));
  setTimeout(file, 45_000);
  setInterval(file, 60_000).unref();
  // Health checks: every 5 minutes, each organization runs when its own interval (Admin › Health) is up.
  const { runDueHealthChecks } = await import('./src/services/health');
  const { pruneNotifications } = await import('./src/services/polish');
  const health = () => runDueHealthChecks().catch((e) => console.error('[health] failed', e));
  setTimeout(health, 90_000);
  setInterval(health, 5 * 60_000).unref();
  setInterval(() => void pruneNotifications().catch(() => {}), 24 * 60 * 60_000).unref();
  // Security: tell admins about new warnings from the audit trail.
  const { runSecurityAlerts } = await import('./src/services/security');
  setInterval(() => void runSecurityAlerts().catch((e) => console.error('[security] alerts failed', e)), 5 * 60_000).unref();
  const { pruneAssistant } = await import('./src/services/assistant');
  setInterval(() => void pruneAssistant().catch((e) => console.error('[assistant] prune failed', e)), 24 * 60 * 60_000).unref();
  // Reports: saved reports and export mappings on a schedule, and the weekly update to each PM.
  const { runScheduledReports, runPmWeekly } = await import('./src/services/report-builder');
  const reports = () => {
    runScheduledReports()
      .then((n) => n && console.log(`[reports] sent ${n} scheduled report(s)`))
      .catch((e) => console.error('[reports] failed', e));
    runPmWeekly()
      .then((n) => n && console.log(`[reports] sent ${n} weekly PM update(s)`))
      .catch((e) => console.error('[reports] PM weekly failed', e));
  };
  setTimeout(reports, 120_000);
  setInterval(reports, 10 * 60_000).unref();
  // Push notifications: send new ones to phones / PCs that turned them on.
  const { dispatchPushes } = await import('./src/services/push');
  setInterval(() => void dispatchPushes().catch((e) => console.error('[push] failed', e)), 20_000).unref();
}
