import { route } from '@/lib/http';
import { sendPoToVendor } from '@/services/purchasing';

export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => sendPoToVendor(auth, params.id!),
});
