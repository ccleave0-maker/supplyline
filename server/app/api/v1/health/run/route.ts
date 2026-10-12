import { route } from '@/lib/http';
import { runHealthNow } from '@/services/health';

export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => runHealthNow(auth),
});
