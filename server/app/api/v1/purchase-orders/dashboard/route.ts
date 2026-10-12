import { route } from '@/lib/http';
import { poDashboard } from '@/services/purchasing';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => poDashboard(auth),
});
