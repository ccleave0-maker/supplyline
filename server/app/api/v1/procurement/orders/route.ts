import { route } from '@/lib/http';
import { procurementQueue } from '@/services/procurement';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const show = url.searchParams.get('show');
    return procurementQueue(auth, {
      show: show === 'onorder' || show === 'all' ? show : 'todo',
      companyId: url.searchParams.get('companyId') || undefined,
    });
  },
});
