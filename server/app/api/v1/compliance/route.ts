import { route } from '@/lib/http';
import { complianceOverview, vendorCompliance } from '@/services/project';

export const { GET, OPTIONS } = route({
  // ?vendor=Name&companyId=… checks one vendor (for PO screens); otherwise everyone.
  GET: async ({ auth, url }) => {
    const vendor = url.searchParams.get('vendor');
    const companyId = url.searchParams.get('companyId');
    if (vendor && companyId) return { summary: await vendorCompliance(auth, companyId, vendor) };
    return complianceOverview(auth);
  },
});
