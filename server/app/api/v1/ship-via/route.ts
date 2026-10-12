import { shipViaInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listShipVia, saveShipVia } from '@/services/ship-via';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listShipVia(auth, { companyId: url.searchParams.get('companyId') ?? undefined, includeInactive: url.searchParams.get('all') === '1' }),
  POST: async ({ req, auth }) => saveShipVia(auth, null, await parseJson(req, shipViaInput)),
});
