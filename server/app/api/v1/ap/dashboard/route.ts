import { route } from '@/lib/http';
import { apDashboard } from '@/services/ap';

export const { GET, OPTIONS } = route({
  GET: async ({ auth }) => apDashboard(auth),
});
