import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { availableLots } from '@/services/bols';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const locationId = url.searchParams.get('locationId');
    if (!locationId) throw badRequest('Pick a pickup location.');
    return availableLots(auth, locationId, url.searchParams.get('companyId') || undefined);
  },
});
