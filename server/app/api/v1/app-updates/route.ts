import { route } from '@/lib/http';
import { updateFor } from '@/services/app-updates';

// Asked by the PC app's updater: ?target=windows&arch=x86_64&version=0.1.0. 204 = up to date.
export const { GET, OPTIONS } = route({
  GET: {
    public: true,
    handler: async ({ url }) => {
      const q = url.searchParams;
      const u = await updateFor(q.get('target') ?? '', q.get('arch') ?? '', q.get('version') ?? '0.0.0', url.origin);
      return u ?? new Response(null, { status: 204 });
    },
  },
});
