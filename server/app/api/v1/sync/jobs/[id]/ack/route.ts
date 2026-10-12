import { z } from 'zod';
import { unauthorized } from '@/lib/errors';
import { parseJson, route } from '@/lib/http';
import { deviceFromRequest, syncAck } from '@/services/filing';

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
      const b = await parseJson(req, z.object({ ok: z.boolean(), error: z.string().max(500).optional() }));
      return syncAck(d.organizationId, params.id!, b.ok, b.error);
    },
  },
});
