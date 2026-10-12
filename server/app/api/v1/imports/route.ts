import { importInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { runImport } from '@/services/imports';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => runImport(auth, await parseJson(req, importInput)),
});
