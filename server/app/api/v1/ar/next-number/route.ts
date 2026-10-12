import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { nextArNumber } from '@/services/accounting';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) throw badRequest('Pick the company.');
    return nextArNumber(auth, companyId);
  },
});
