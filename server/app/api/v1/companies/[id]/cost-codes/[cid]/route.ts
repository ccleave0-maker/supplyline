import { route } from '@/lib/http';
import { removeCostCode } from '@/services/cost-codes';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => {
    await removeCostCode(auth, params.id!, params.cid!);
    return { ok: true };
  },
});
