import { route } from '@/lib/http';
import { removeEmailRecipient } from '@/services/companies';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => {
    await removeEmailRecipient(auth, params.id!, params.rid!);
    return { ok: true };
  },
});
