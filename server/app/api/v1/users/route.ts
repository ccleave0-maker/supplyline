import { route } from '@/lib/http';
import { listUsers } from '@/services/users';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => listUsers(auth, url.searchParams.get('includeInactive') === 'true'),
});
