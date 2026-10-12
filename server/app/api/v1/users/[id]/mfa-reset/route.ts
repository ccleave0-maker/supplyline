import { route } from '@/lib/http';
import { resetUserMfa } from '@/services/security';

// Admin: someone lost their phone — they set up the authenticator app again at next sign-in.
export const { POST, OPTIONS } = route({
  POST: async ({ auth, params }) => resetUserMfa(auth, params.id!),
});
