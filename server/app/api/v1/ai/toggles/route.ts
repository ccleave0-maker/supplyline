import { aiToggleInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listToggles, saveToggles } from '@/services/ai';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => listToggles(auth),
  PUT: async ({ req, auth }) => saveToggles(auth, await parseJson(req, aiToggleInput)),
});
