import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { suggestPoNumber } from '@/services/purchasing';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) throw badRequest('Pick the company.');
    return suggestPoNumber(auth, companyId);
  },
});
