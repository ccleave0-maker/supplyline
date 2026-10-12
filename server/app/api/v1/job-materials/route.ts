import { route } from '@/lib/http';
import { jobMaterials } from '@/services/planning';

// Where each job's material is: outstanding, in the yard, staged / on a planned load, on the way, received.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => jobMaterials(auth, { siteId: url.searchParams.get('siteId') ?? undefined, openOnly: url.searchParams.get('open') === '1' }),
});
