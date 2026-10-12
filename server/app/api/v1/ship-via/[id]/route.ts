import { shipViaInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { saveShipVia } from '@/services/ship-via';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveShipVia(auth, params.id!, await parseJson(req, shipViaInput)),
});
