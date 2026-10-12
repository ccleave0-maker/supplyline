import { REPORTS, type ReportKey } from '@supplyline/core/models';
import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { runReport } from '@/services/reports';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params, url }) => {
    if (!REPORTS.some((r) => r.key === params.key)) throw badRequest('Unknown report.');
    return runReport(auth, params.key as ReportKey, { from: url.searchParams.get('from') ?? '', to: url.searchParams.get('to') ?? '', companyId: url.searchParams.get('companyId') ?? undefined });
  },
});
