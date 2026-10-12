import { savedReportInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listSavedReports, saveReport } from '@/services/report-builder';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listSavedReports(auth),
  POST: async ({ req, auth }) => saveReport(auth, null, await parseJson(req, savedReportInput)),
});
