import { userAccessInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setUserAccess } from '@/services/access-admin';

// Extra business units and what this person may buy for.
export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => setUserAccess(auth, params.id!, await parseJson(req, userAccessInput)),
});
