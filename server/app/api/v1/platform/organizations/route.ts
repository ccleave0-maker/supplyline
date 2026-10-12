import { orgCreateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createOrganization, listOrganizations } from '@/services/organizations';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listOrganizations(auth),
  POST: async ({ req, auth }) => createOrganization(auth, await parseJson(req, orgCreateInput)),
});
