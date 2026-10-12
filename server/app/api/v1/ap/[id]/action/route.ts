import { apActionInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { apAction } from '@/services/ap';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => apAction(auth, params.id!, await parseJson(req, apActionInput)),
});
