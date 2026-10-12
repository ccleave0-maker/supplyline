import { bolInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteDraftBol, getBol, updateBol } from '@/services/bols';

export const { GET, PUT, DELETE, OPTIONS } = route({
  GET: async ({ auth, params }) => getBol(auth, params.id!),
  PUT: async ({ req, auth, params }) => updateBol(auth, params.id!, await parseJson(req, bolInput)),
  DELETE: async ({ auth, params }) => {
    await deleteDraftBol(auth, params.id!);
    return { ok: true };
  },
});
