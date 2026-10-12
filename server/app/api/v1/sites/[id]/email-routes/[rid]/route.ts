import { route } from '@/lib/http';
import { removeSiteEmailRoute } from '@/services/sites';

export const { DELETE, OPTIONS } = route({
  DELETE: async ({ auth, params }) => {
    await removeSiteEmailRoute(auth, params.id!, params.rid!);
    return { ok: true };
  },
});
