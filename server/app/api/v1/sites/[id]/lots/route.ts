import { route } from '@/lib/http';
import { lotsAtSite } from '@/services/bols';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => lotsAtSite(auth, params.id!),
});
