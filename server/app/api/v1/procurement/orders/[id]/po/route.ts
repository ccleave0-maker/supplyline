import { assignPoInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { assignPo } from '@/services/procurement';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => assignPo(auth, params.id!, await parseJson(req, assignPoInput)),
});
