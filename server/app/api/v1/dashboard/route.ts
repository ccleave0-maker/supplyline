import { route } from '@/lib/http';
import { dashboard } from '@/services/polish';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => dashboard(auth),
});
