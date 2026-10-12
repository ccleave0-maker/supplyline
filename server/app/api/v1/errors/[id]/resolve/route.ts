import { route } from '@/lib/http';
import { resolveError } from '@/services/errors';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => resolveError(auth, params.id!),
});
