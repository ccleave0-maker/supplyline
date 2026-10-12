import { costCodeInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createCostCode, listCostCodes } from '@/services/cost-codes';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params, url }) => listCostCodes(auth, params.id!, url.searchParams.get('siteId') ?? undefined),
  POST: async ({ req, auth, params }) => createCostCode(auth, params.id!, await parseJson(req, costCodeInput)),
});
