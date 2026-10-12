import { customColumnInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createCustomColumn, listCustomColumns } from '@/services/procurement';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, params }) => listCustomColumns(auth, params.id!),
  POST: async ({ req, auth, params }) => createCustomColumn(auth, params.id!, await parseJson(req, customColumnInput)),
});
