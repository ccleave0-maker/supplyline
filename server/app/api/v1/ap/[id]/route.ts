import { apInvoiceEditInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { editApInvoice, getApInvoice } from '@/services/ap';

export const { GET, PATCH, OPTIONS } = route({
  GET: async ({ auth, params }) => getApInvoice(auth, params.id!),
  PATCH: async ({ req, auth, params }) => editApInvoice(auth, params.id!, await parseJson(req, apInvoiceEditInput)),
});
