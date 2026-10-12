import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { pickUpAtVendor } from '@/services/po-bol';

// The truck picks these PO lines up at the vendor.
export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const b = await parseJson(req, z.object({ lines: z.array(z.object({ poLineId: z.string().min(1).max(40), qty: z.number().positive().max(1e9) })).min(1).max(200) }));
    return pickUpAtVendor(auth, params.poId!, b.lines);
  },
});
