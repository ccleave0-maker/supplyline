import { apDecisionInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { decide } from '@/services/ap';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => decide(auth, params.id!, await parseJson(req, apDecisionInput)),
});
