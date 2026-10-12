import { aiSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getAiSettings, saveAiSettings } from '@/services/ai';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => getAiSettings(auth),
  PUT: async ({ req, auth }) => saveAiSettings(auth, await parseJson(req, aiSettingsInput)),
});
