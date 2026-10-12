import { customColumnUpdate } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteCustomColumn, updateCustomColumn } from '@/services/procurement';

export const { PATCH, DELETE, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => updateCustomColumn(auth, params.id!, params.cid!, await parseJson(req, customColumnUpdate)),
  DELETE: async ({ auth, params }) => {
    await deleteCustomColumn(auth, params.id!, params.cid!);
    return { ok: true };
  },
});
