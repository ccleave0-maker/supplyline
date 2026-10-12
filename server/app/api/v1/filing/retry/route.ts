import { route } from '@/lib/http';
import { retryFiling } from '@/services/filing';

// Put failed copies back in the queue and try the folder again now.
export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => retryFiling(auth),
});
