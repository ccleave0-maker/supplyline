import { inviteInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createInvite, listInvites } from '@/services/users';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listInvites(auth),
  POST: async ({ req, auth }) => createInvite(auth, await parseJson(req, inviteInput)),
});
