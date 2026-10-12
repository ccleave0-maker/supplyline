import { navSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { saveNavSettings } from '@/services/access-admin';

// The organization's menu: areas, and what each role may have.
export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth }) => saveNavSettings(auth, await parseJson(req, navSettingsInput)),
});
