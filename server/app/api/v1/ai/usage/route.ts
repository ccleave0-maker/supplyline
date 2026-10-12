import { route } from '@/lib/http';
import { usage } from '@/services/ai';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => usage(auth),
});
