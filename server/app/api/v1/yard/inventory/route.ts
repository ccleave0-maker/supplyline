import { route } from '@/lib/http';
import { yardInventory } from '@/services/yard';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => yardInventory(auth, url.searchParams.get('yardId') || undefined),
});
