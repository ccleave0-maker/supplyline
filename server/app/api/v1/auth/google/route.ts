import { googleSignInInput } from '@supplyline/core/models';
import { clientInfo } from '@/lib/client';
import { parseJson, route } from '@/lib/http';
import { signInWithGoogle } from '@/services/auth';

export const { POST, OPTIONS } = route({
  POST: {
    public: true,
    handler: async ({ req }) => {
      const { idToken } = await parseJson(req, googleSignInInput);
      return signInWithGoogle(idToken, clientInfo(req));
    },
  },
});
