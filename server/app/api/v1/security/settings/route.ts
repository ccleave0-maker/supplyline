import { securitySettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getSecuritySettings, saveSecuritySettings } from '@/services/security';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => getSecuritySettings(auth),
  PUT: async ({ req, auth }) => saveSecuritySettings(auth, await parseJson(req, securitySettingsInput)),
});
