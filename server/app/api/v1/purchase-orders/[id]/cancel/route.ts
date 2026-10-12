import { route } from '@/lib/http';
import { cancelPo } from '@/services/purchasing';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => cancelPo(auth, params.id!),
});
