import { siteEmailRouteInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { addSiteEmailRoute } from '@/services/sites';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => addSiteEmailRoute(auth, params.id!, await parseJson(req, siteEmailRouteInput)),
});
