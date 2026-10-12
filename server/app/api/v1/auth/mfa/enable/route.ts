import { mfaCodeInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { enableMfa } from '@/services/security';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => enableMfa(auth, (await parseJson(req, mfaCodeInput)).code),
});
