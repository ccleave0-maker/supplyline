import { apRejectionSendInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { sendRejection } from '@/services/ap';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => sendRejection(auth, params.id!, await parseJson(req, apRejectionSendInput)),
});
