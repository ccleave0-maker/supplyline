import { optimizeInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { optimize } from '@/services/optimizer';

// Everything waiting to move → suggested combined loads, trailers, order and dates.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => optimize(auth, await parseJson(req, optimizeInput)),
});
