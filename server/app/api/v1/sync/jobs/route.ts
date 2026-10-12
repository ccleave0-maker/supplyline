import { unauthorized } from '@/lib/errors';
import { route } from '@/lib/http';
import { deviceFromRequest, syncPending } from '@/services/filing';

async function device(req: Request) {
  const d = await deviceFromRequest(req);
  if (!d) throw unauthorized('This Sync app key is not valid (it may have been removed in Admin › Network filing).');
  return d;
}

// Documents waiting to be written into the network folders.
export const { GET, OPTIONS } = route({
  GET: { public: true, handler: async ({ req }) => syncPending((await device(req)).organizationId) },
});
