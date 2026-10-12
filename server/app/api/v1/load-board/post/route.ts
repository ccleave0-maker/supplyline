import { postLoadInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { postLoad } from '@/services/board';

// "New load available": a one-off load with priority and dates.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => postLoad(auth, await parseJson(req, postLoadInput)),
});
