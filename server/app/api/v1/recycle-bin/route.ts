import { route } from '@/lib/http';
import { listDeleted } from '@/services/trash';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => listDeleted(auth),
});
