import { route } from '@/lib/http';
import { tokenHistory } from '@/services/ai';

// Token use by day / model / screen, with the cost in CAD (admins).
export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => tokenHistory(auth, Math.min(730, Math.max(1, Number(url.searchParams.get('days')) || 90))),
});
