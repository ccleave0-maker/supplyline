import { route } from '@/lib/http';
import { getSiteReceipt } from '@/services/bols';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => getSiteReceipt(auth, params.id!),
});
