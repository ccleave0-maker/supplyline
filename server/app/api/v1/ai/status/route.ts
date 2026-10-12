import { route } from '@/lib/http';
import { aiStatus } from '@/services/ai';

// What this person can use (never includes keys).
export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => aiStatus(auth),
});
