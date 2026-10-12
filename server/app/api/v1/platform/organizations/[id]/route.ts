import { orgUpdateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { updateOrganization } from '@/services/organizations';

export const { PATCH, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => {
    await updateOrganization(auth, params.id!, await parseJson(req, orgUpdateInput));
    return { ok: true };
  },
});
