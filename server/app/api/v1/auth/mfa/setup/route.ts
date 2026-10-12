import { route } from '@/lib/http';
import { startMfaSetup } from '@/services/security';

// Start setting up an authenticator app: the secret (and QR link) to add to it.
export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => startMfaSetup(auth),
});
