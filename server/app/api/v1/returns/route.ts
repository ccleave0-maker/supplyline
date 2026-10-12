import { returnInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createReturn } from '@/services/bols';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => createReturn(auth, await parseJson(req, returnInput)),
});
