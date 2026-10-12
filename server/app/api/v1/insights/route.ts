import { route } from '@/lib/http';
import { insights } from '@/services/suggestions';

// Admins only: patterns from this organization's own data.
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => insights(auth, Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 90))),
});
