import { route } from '@/lib/http';
import { incomingShipments } from '@/services/yard';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => incomingShipments(auth, url.searchParams.get('yardId') || undefined),
});
