import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { payRuns } from '@/services/ap';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) throw badRequest('Pick the company.');
    return payRuns(auth, companyId);
  },
});
