import { poInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteDraftPo, getPo, updatePo } from '@/services/purchasing';

export const { GET, PUT, DELETE, OPTIONS } = route({
  GET: async ({ auth, params }) => getPo(auth, params.id!),
  PUT: async ({ req, auth, params }) => updatePo(auth, params.id!, await parseJson(req, poInput)),
  DELETE: async ({ auth, params }) => deleteDraftPo(auth, params.id!),
});
