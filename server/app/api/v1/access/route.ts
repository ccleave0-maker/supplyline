import { accessSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getAccessSettings, saveAccessSettings } from '@/services/access-admin';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => getAccessSettings(auth),
  PUT: async ({ req, auth }) => saveAccessSettings(auth, await parseJson(req, accessSettingsInput)),
});
