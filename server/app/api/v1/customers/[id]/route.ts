import { customerInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { saveCustomer } from '@/services/accounting';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveCustomer(auth, params.id!, await parseJson(req, customerInput)),
});
