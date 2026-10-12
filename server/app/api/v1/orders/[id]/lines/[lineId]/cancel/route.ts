import { cancelLineInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { cancelLine } from '@/services/orders';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const { reason } = await parseJson(req, cancelLineInput);
    return cancelLine(auth, params.id!, params.lineId!, reason ?? null);
  },
});
