import { loadPlanInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { planForTrailer } from '@/services/loads';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => planForTrailer(auth, await parseJson(req, loadPlanInput)),
});
