import { accountingSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getAccountingSettings, saveAccountingSettings } from '@/services/ap';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getAccountingSettings(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveAccountingSettings(auth, params.id!, await parseJson(req, accountingSettingsInput)),
});
