import { route } from '@/lib/http';
import { meetingPeople } from '@/services/meetings';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => meetingPeople(auth, { siteId: url.searchParams.get('siteId') ?? undefined, companyId: url.searchParams.get('companyId') ?? undefined }),
});
