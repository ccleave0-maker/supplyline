import { z } from 'zod';
import { unauthorized } from '@/lib/errors';
import { parseJson, route } from '@/lib/http';
import { deviceFromRequest, syncApMoved } from '@/services/filing';

async function device(req: Request) {
  const d = await deviceFromRequest(req);
  if (!d) throw unauthorized('This Sync app key is not valid (it may have been removed in Admin › Network filing).');
  return d;
}

export const { POST, OPTIONS } = route({
  POST: {
    public: true,
    handler: async ({ req, params }) => {
      const d = await device(req);
      const b = await parseJson(req, z.object({ state: z.string().max(20), newPath: z.string().min(1).max(500) }));
      return syncApMoved(d.organizationId, params.id!, b.state, b.newPath);
    },
  },
});
