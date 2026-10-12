import { route } from '@/lib/http';
import { getBilling } from '@/services/billing';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => getBilling(auth),
});
