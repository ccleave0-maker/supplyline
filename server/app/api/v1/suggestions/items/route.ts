import { route } from '@/lib/http';
import { suggestItems } from '@/services/suggestions';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => suggestItems(auth, { q: url.searchParams.get('q') ?? '', siteId: url.searchParams.get('siteId'), companyId: url.searchParams.get('companyId') }),
});
