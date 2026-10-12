import { actionItemInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { updateAction } from '@/services/meetings';

export const { PATCH, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => updateAction(auth, params.id!, await parseJson(req, actionItemInput.partial())),
});
