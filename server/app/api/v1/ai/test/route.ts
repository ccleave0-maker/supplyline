import { route } from '@/lib/http';
import { testAi } from '@/services/ai';

export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => testAi(auth),
});
