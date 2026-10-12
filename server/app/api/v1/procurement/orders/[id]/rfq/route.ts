import { rfqInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { markRfq } from '@/services/procurement';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => {
    const { lineIds, sent } = await parseJson(req, rfqInput);
    return markRfq(auth, params.id!, lineIds, sent);
  },
});
