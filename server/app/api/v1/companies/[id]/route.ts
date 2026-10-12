import { companyUpdateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getCompany, updateCompany } from '@/services/companies';

export const { GET, PATCH, OPTIONS } = route({
  GET: async ({ auth, params }) => getCompany(auth, params.id!),
  PATCH: async ({ req, auth, params }) => updateCompany(auth, params.id!, await parseJson(req, companyUpdateInput)),
});
