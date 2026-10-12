import { filingSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getFilingSettings, saveFilingSettings } from '@/services/filing';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getFilingSettings(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveFilingSettings(auth, params.id!, await parseJson(req, filingSettingsInput)),
});
