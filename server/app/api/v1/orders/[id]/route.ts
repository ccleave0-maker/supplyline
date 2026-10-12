import { saveDraftInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteDraft, getOrder, saveDraft } from '@/services/orders';

export const { GET, PUT, DELETE, OPTIONS } = route({
  GET: async ({ auth, params }) => getOrder(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveDraft(auth, params.id!, await parseJson(req, saveDraftInput)),
  DELETE: async ({ auth, params }) => {
    await deleteDraft(auth, params.id!);
    return { ok: true };
  },
});
