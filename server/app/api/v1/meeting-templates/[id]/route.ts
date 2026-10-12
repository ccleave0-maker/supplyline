import { meetingTemplateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { saveTemplate } from '@/services/meetings';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveTemplate(auth, params.id!, await parseJson(req, meetingTemplateInput)),
});
