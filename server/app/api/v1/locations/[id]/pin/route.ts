import { pinInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setLocationPin } from '@/services/board';

// Pin a location from a Google / Apple Maps link, geo: link, coordinates or an address.
export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => setLocationPin(auth, params.id!, (await parseJson(req, pinInput)).text),
});
