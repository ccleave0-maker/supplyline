import { receiveBolInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { receiveBol } from '@/services/bols';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => receiveBol(auth, params.id!, await parseJson(req, receiveBolInput)),
});
