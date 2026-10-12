import { emailTemplateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { resetTemplate, saveTemplate } from '@/services/mail';

export const { PUT, DELETE, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveTemplate(auth, params.id!, params.key!, await parseJson(req, emailTemplateInput)),
  // Back to the standard wording
  DELETE: async ({ auth, params }) => resetTemplate(auth, params.id!, params.key!),
});
