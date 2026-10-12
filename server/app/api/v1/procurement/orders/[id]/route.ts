import { route } from '@/lib/http';
import { getProcurementOrder } from '@/services/procurement';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => getProcurementOrder(auth, params.id!),
});
