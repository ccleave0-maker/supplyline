import { companyCreateInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createCompany, listCompanies } from '@/services/companies';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listCompanies(auth),
  POST: async ({ req, auth }) => createCompany(auth, await parseJson(req, companyCreateInput)),
});
