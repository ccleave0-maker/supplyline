import { route } from '@/lib/http';
import { cancelBol } from '@/services/bols';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => cancelBol(auth, params.id!),
});
