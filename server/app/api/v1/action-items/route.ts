import { route } from '@/lib/http';
import { listActions } from '@/services/meetings';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const status = url.searchParams.get('status');
    return listActions(auth, { mine: url.searchParams.get('mine') === '1', siteId: url.searchParams.get('siteId') ?? undefined, status: status === 'DONE' || status === 'ALL' ? status : 'OPEN' });
  },
});
