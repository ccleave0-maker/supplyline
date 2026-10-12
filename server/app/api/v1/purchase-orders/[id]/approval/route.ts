import { poApprovalInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { decideApproval } from '@/services/purchasing';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => decideApproval(auth, params.id!, await parseJson(req, poApprovalInput)),
});
