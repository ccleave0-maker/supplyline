import { healthSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getHealthSettings, listHealthRuns, saveHealthSettings } from '@/services/health';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth }) => ({ settings: await getHealthSettings(auth), runs: await listHealthRuns(auth) }),
  PUT: async ({ req, auth }) => saveHealthSettings(auth, await parseJson(req, healthSettingsInput)),
});
