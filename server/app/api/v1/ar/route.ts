import { arInvoiceInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listArInvoices, saveArInvoice } from '@/services/accounting';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const q = (k: string) => url.searchParams.get(k) || undefined;
    return listArInvoices(auth, { state: q('state') as never, customerId: q('customerId'), siteId: q('siteId'), companyId: q('companyId') });
  },
  POST: async ({ req, auth }) => saveArInvoice(auth, null, await parseJson(req, arInvoiceInput)),
});
