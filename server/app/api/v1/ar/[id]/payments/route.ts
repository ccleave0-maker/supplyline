import { arPaymentInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { recordArPayment } from '@/services/accounting';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => recordArPayment(auth, params.id!, await parseJson(req, arPaymentInput)),
});
