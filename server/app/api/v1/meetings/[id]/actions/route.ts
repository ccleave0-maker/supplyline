import { actionItemInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { addAction } from '@/services/meetings';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params, url }) => addAction(auth, params.id!, await parseJson(req, actionItemInput), url.searchParams.get('source') === 'ai' ? 'AI' : 'MANUAL'),
});
