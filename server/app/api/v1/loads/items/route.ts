import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { loadItems } from '@/services/loads';

// Material ready to load at a location (optionally only for one job).
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const locationId = url.searchParams.get('locationId');
    if (!locationId) throw badRequest('Pick where the material is.');
    return loadItems(auth, { locationId, siteId: url.searchParams.get('siteId') ?? undefined, companyId: url.searchParams.get('companyId') ?? undefined });
  },
});
