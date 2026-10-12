import { route } from '@/lib/http';
import { listFilingJobs } from '@/services/filing';

export const { GET, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const show = url.searchParams.get('show');
    return listFilingJobs(auth, show === 'failed' || show === 'done' ? show : 'pending');
  },
});
