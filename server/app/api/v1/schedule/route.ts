import { route } from '@/lib/http';
import { listSchedule } from '@/services/schedule';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const q = (k: string) => url.searchParams.get(k) || undefined;
    return listSchedule(auth, {
      from: q('from') ?? '',
      to: q('to') ?? '',
      siteId: q('siteId'),
      companyId: q('companyId'),
      carrierId: q('carrierId'),
      includeUndated: url.searchParams.get('includeUndated') === 'true',
    });
  },
});
