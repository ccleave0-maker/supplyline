import { route } from '@/lib/http';
import { revokeInvite } from '@/services/users';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => {
    await revokeInvite(auth, params.id!);
    return { ok: true };
  },
});
