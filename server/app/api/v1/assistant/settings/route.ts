import { assistantSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getAssistantSettings, saveAssistantSettings } from '@/services/assistant';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => getAssistantSettings(auth),
  PUT: async ({ req, auth }) => saveAssistantSettings(auth, await parseJson(req, assistantSettingsInput)),
});
