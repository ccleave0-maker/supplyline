import { locationInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createLocation, listLocations } from '@/services/locations';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) =>
    listLocations(auth, { q: url.searchParams.get('q')?.trim() || undefined, includeInactive: url.searchParams.get('includeInactive') === 'true' }),
  // ?source=auto when a new stop is typed in while building a BOL.
  POST: async ({ req, auth, url }) => createLocation(auth, await parseJson(req, locationInput), url.searchParams.get('source') === 'auto' ? 'AUTO' : 'MANUAL'),
});
