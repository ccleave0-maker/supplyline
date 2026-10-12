import { route } from '@/lib/http';
import { getReceipt } from '@/services/yard';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => getReceipt(auth, params.id!),
});
