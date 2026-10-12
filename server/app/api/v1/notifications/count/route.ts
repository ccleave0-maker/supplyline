import { route } from '@/lib/http';
import { unreadCount } from '@/services/polish';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => unreadCount(auth),
});
