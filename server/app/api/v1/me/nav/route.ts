import { navLayoutInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { saveMyNav } from '@/services/access-admin';

// My own menu order (DELETE = back to the organization's).
export const { PUT, DELETE, OPTIONS } = route({
  PUT: async ({ req, auth }) => saveMyNav(auth, await parseJson(req, navLayoutInput)),
  DELETE: async ({ auth }) => saveMyNav(auth, null),
});
