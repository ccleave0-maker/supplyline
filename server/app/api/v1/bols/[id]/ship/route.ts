import { route } from '@/lib/http';
import { shipBol } from '@/services/bols';

// The truck has left: mark shipped and tell everyone set up on the drop-off jobs.
export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => shipBol(auth, params.id!),
});
