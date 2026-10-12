import { route } from '@/lib/http';
import { requestLog } from '@/services/ai';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => requestLog(auth),
});
