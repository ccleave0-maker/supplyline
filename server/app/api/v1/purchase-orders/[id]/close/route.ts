import { route } from '@/lib/http';
import { closePo } from '@/services/purchasing';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => closePo(auth, params.id!),
});
