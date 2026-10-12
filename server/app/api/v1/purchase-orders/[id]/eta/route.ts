import { poEtaInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setPoEta } from '@/services/purchasing';

// Change the expected delivery date (re-arms the 1 PM chase-up).
export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => setPoEta(auth, params.id!, (await parseJson(req, poEtaInput)).expectedDate),
});
