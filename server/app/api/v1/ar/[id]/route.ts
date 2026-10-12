import { arInvoiceInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getArInvoice, saveArInvoice } from '@/services/accounting';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getArInvoice(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveArInvoice(auth, params.id!, await parseJson(req, arInvoiceInput)),
});
