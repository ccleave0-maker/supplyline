import { siteMembersInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setSiteMembers } from '@/services/sites';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => {
    const { userIds } = await parseJson(req, siteMembersInput);
    await setSiteMembers(auth, params.id!, userIds);
    return { ok: true };
  },
});
