import { route } from '@/lib/http';
import { publicBranding } from '@/services/companies';

export const { GET, OPTIONS } = route({
  GET: {
    public: true,
    handler: async ({ url }) => publicBranding(url.searchParams.get('companyId')),
  },
});
