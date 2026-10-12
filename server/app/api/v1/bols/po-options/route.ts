import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { posForBol } from '@/services/po-bol';

// Job POs a BOL can be built from.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) throw badRequest('Pick the company.');
    return posForBol(auth, companyId);
  },
});
