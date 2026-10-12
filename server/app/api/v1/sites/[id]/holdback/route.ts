import { subHoldbackInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getSubHoldback, saveSubHoldback } from '@/services/accounting';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getSubHoldback(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveSubHoldback(auth, params.id!, await parseJson(req, subHoldbackInput)),
});
