import { userUpdateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { updateUser } from '@/services/users';

export const { PATCH, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => {
    await updateUser(auth, params.id!, await parseJson(req, userUpdateInput));
    return { ok: true };
  },
});
