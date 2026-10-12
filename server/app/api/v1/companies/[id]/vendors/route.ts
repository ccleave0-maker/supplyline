import { route } from '@/lib/http';
import { listVendors } from '@/services/procurement';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => listVendors(auth, params.id!),
});
