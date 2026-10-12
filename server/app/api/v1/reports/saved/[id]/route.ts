import { savedReportInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteReport, saveReport } from '@/services/report-builder';

export const { PUT, DELETE, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveReport(auth, params.id!, await parseJson(req, savedReportInput)),
  DELETE: async ({ auth, params }) => deleteReport(auth, params.id!),
});
