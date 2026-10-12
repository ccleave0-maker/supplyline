import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { poDefaults } from '@/services/suggestions';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) throw badRequest('companyId is required');
    return poDefaults(auth, { companyId, vendorName: url.searchParams.get('vendorName'), description: url.searchParams.get('description') });
  },
});
