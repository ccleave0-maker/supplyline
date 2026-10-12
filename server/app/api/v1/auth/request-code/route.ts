import { requestCodeInput } from '@supplyline/core/models';
import { clientInfo } from '@/lib/client';
import { parseJson, route } from '@/lib/http';
import { requestLoginCode } from '@/services/auth';

export const { POST, OPTIONS } = route({
  POST: {
    public: true,
    handler: async ({ req }) => {
      const { email } = await parseJson(req, requestCodeInput);
      return requestLoginCode(email, clientInfo(req));
    },
  },
});
