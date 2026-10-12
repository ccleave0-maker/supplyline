import { route } from '@/lib/http';
import { submitOrder } from '@/services/orders';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => submitOrder(auth, params.id!),
});
