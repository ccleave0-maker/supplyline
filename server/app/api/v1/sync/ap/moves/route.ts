import { unauthorized } from '@/lib/errors';
import { route } from '@/lib/http';
import { deviceFromRequest, syncApMoves } from '@/services/filing';

async function device(req: Request) {
  const d = await deviceFromRequest(req);
  if (!d) throw unauthorized('This Sync app key is not valid (it may have been removed in Admin › Network filing).');
  return d;
}

// Invoice files to move to In review / Approved / Rejected / On hold.
export const { GET, OPTIONS } = route({
  GET: { public: true, handler: async ({ req }) => syncApMoves((await device(req)).organizationId) },
});
