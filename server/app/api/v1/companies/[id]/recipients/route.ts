import { emailRecipientInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { addEmailRecipient } from '@/services/companies';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => addEmailRecipient(auth, params.id!, await parseJson(req, emailRecipientInput)),
});
