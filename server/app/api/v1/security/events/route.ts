import { route } from '@/lib/http';
import { securityEvents } from '@/services/security';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => securityEvents(auth, Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30))),
});
