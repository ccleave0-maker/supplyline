import { poLineUpdate } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { removePoLine, updatePoLine } from '@/services/procurement';

export const { PATCH, DELETE, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => updatePoLine(auth, params.id!, await parseJson(req, poLineUpdate)),
  DELETE: async ({ auth, params }) => removePoLine(auth, params.id!),
});
