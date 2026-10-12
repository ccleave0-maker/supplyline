import { notifyRulesInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getNotifySetup, saveNotifySetup } from '@/services/notify';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getNotifySetup(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveNotifySetup(auth, params.id!, await parseJson(req, notifyRulesInput)),
});
