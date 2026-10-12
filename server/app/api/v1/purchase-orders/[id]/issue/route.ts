import { poIssueInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { issuePo } from '@/services/purchasing';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => issuePo(auth, params.id!, await parseJson(req, poIssueInput)),
});
