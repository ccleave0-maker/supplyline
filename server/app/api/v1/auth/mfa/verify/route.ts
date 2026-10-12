import { mfaCodeInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { verifyMfa } from '@/services/security';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => verifyMfa(auth, (await parseJson(req, mfaCodeInput)).code),
});
