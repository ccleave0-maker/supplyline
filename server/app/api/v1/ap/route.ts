import { badRequest } from '@/lib/errors';
import { route } from '@/lib/http';
import { listApInvoices, receiveInvoice } from '@/services/ap';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const q = (k: string) => url.searchParams.get(k)?.trim() || undefined;
    return listApInvoices(auth, { show: q('show') as never, q: q('q'), siteId: q('siteId'), companyId: q('companyId') });
  },
  // Drop an invoice in (PDF / photo): it's read, matched and sent on.
  POST: async ({ req, auth, url }) => {
    const companyId = url.searchParams.get('companyId');
    if (!companyId) throw badRequest('Pick the company.');
    const form = await req.formData().catch(() => null);
    const f = form?.get('file');
    if (!(f instanceof File) || f.size === 0) throw badRequest('Choose the invoice file.');
    return receiveInvoice(auth, companyId, f);
  },
});
