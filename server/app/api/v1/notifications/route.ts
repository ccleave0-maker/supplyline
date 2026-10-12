import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { listNotifications, markNotificationsRead } from '@/services/polish';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listNotifications(auth, { unread: url.searchParams.get('unread') === '1' }),
  // Mark read: { ids: [...] } or { all: true }
  POST: async ({ req, auth }) => {
    const b = await parseJson(req, z.object({ ids: z.array(z.string().max(40)).max(500).optional(), all: z.boolean().optional() }));
    return markNotificationsRead(auth, b.all ? 'all' : (b.ids ?? []));
  },
});
