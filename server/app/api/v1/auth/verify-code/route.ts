import { verifyCodeInput } from '@supplyline/core/models';
import { clientInfo } from '@/lib/client';
import { parseJson, route } from '@/lib/http';
import { verifyLoginCode } from '@/services/auth';

export const { POST, OPTIONS } = route({
  POST: {
    public: true,
    handler: async ({ req }) => {
      const { email, code } = await parseJson(req, verifyCodeInput);
      return verifyLoginCode(email, code, clientInfo(req));
    },
  },
});
