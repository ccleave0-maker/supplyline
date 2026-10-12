import { profileUpdateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteOwnAccount } from '@/services/auth';
import { buildMe } from '@/services/me';
import { updateOwnProfile } from '@/services/users';

export const { GET, PATCH, DELETE, OPTIONS } = route({
  GET: async ({ auth }) => buildMe(auth.userId, auth.sessionId),
  PATCH: async ({ req, auth }) => updateOwnProfile(auth, await parseJson(req, profileUpdateInput)),
  DELETE: async ({ auth }) => {
    await deleteOwnAccount(auth);
    return { ok: true };
  },
});
