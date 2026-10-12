import { meetingTemplateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listTemplates, saveTemplate } from '@/services/meetings';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listTemplates(auth, url.searchParams.get('all') === '1'),
  POST: async ({ req, auth }) => saveTemplate(auth, null, await parseJson(req, meetingTemplateInput)),
});
