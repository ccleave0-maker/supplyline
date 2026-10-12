import { complianceInput } from '@supplyline/core/models';
import { parseForm, route } from '@/lib/http';
import { addCompliance, contactCompliance } from '@/services/project';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params }) => contactCompliance(auth, params.id!),
  POST: async ({ req, auth, params }) => {
    const { data, file } = await parseForm(req, complianceInput);
    return addCompliance(auth, params.id!, data, file);
  },
});
