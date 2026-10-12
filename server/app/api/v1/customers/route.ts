import { customerInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listCustomers, saveCustomer } from '@/services/accounting';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listCustomers(auth, { q: url.searchParams.get('q') ?? undefined, companyId: url.searchParams.get('companyId') ?? undefined, includeInactive: url.searchParams.get('includeInactive') === 'true' }),
  POST: async ({ req, auth }) => saveCustomer(auth, null, await parseJson(req, customerInput)),
});
