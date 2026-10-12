import { route } from '@/lib/http';
import { siteInventory } from '@/services/orders';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, params }) => siteInventory(auth, params.id!),
});
