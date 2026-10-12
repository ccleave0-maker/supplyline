import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { geocode } from '@/integrations/geocode';

export const { GET, OPTIONS } = route({
  GET: async ({ url }) => {
    const q = url.searchParams.get('q')?.trim() ?? '';
    if (q.length < 3) throw badRequest('Type at least 3 characters of the address.');
    return geocode(q.slice(0, 200));
  },
});
