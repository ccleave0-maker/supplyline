import { createOrderInput, type OrderSummary } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createDraft, listOrders } from '@/services/orders';

const STATUSES = ['DRAFT', 'SUBMITTED', 'IN_PROGRESS', 'COMPLETE', 'CANCELLED'];

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const status = url.searchParams.get('status');
    return listOrders(auth, {
      siteId: url.searchParams.get('siteId') ?? undefined,
      companyId: url.searchParams.get('companyId') ?? undefined,
      status: status && STATUSES.includes(status) ? (status as OrderSummary['status']) : undefined,
    });
  },
  POST: async ({ req, auth }) => createDraft(auth, (await parseJson(req, createOrderInput)).siteId),
});
