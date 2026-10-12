import { pmWeeklyInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getPmWeekly, savePmWeekly } from '@/services/report-builder';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => getPmWeekly(auth),
  PUT: async ({ req, auth }) => savePmWeekly(auth, await parseJson(req, pmWeeklyInput)),
});
