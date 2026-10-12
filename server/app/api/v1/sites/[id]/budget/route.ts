import { jobBudgetInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getBudget, saveBudget } from '@/services/accounting';

export const { GET, PUT, OPTIONS } = route({
  GET: async ({ auth, params }) => getBudget(auth, params.id!),
  PUT: async ({ req, auth, params }) => saveBudget(auth, params.id!, await parseJson(req, jobBudgetInput)),
});
