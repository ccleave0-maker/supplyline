import { route } from '@/lib/http';
import { stockCheckQueue } from '@/services/yard';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => stockCheckQueue(auth),
});
