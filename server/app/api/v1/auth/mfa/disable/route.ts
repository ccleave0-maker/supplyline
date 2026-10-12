import { mfaCodeInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { disableMfa } from '@/services/security';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => disableMfa(auth, (await parseJson(req, mfaCodeInput)).code),
});
