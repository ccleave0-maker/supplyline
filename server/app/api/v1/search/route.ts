import { route } from '@/lib/http';
import { search } from '@/services/polish';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => search(auth, (url.searchParams.get('q') ?? '').slice(0, 100)),
});
