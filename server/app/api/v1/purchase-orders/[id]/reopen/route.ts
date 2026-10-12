import { route } from '@/lib/http';
import { reopenPo } from '@/services/purchasing';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => reopenPo(auth, params.id!),
});
