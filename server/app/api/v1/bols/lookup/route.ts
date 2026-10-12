import { route } from '@/lib/http';
import { lookupBol } from '@/services/bols';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => lookupBol(auth, (url.searchParams.get('q') ?? '').slice(0, 120)),
});
