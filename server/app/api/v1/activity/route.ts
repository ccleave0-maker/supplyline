import { route } from '@/lib/http';
import { activityFeed } from '@/services/polish';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => activityFeed(auth, { siteId: url.searchParams.get('siteId') ?? undefined, limit: Number(url.searchParams.get('limit')) || undefined }),
});
