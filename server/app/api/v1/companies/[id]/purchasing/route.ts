import { purchasingSettingsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getPurchasingSettings, savePurchasingSettings } from '@/services/purchasing';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getPurchasingSettings(auth, params.id!),
  PUT: async ({ req, auth, params }) => savePurchasingSettings(auth, params.id!, await parseJson(req, purchasingSettingsInput)),
});
