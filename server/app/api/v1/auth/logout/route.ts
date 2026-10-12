import { route } from '@/lib/http';
import { logout } from '@/services/auth';

export const { POST, OPTIONS } = route({
  POST: async ({ auth }) => {
    await logout(auth);
    return { ok: true };
  },
});
