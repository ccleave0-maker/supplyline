import { siteUpdateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getSite, updateSite } from '@/services/sites';

export const { GET, PATCH, OPTIONS } = route({
  GET: async ({ auth, params }) => getSite(auth, params.id!),
  PATCH: async ({ req, auth, params }) => updateSite(auth, params.id!, await parseJson(req, siteUpdateInput)),
});
