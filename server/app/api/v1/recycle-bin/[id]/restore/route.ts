import { route } from '@/lib/http';
import { restoreDeleted } from '@/services/trash';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => restoreDeleted(auth, params.id!),
});
