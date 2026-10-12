import { assistantAskInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { ask } from '@/services/assistant';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => ask(auth, await parseJson(req, assistantAskInput)),
});
