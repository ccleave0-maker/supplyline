import { exportMappingInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listExportMappings, saveExportMapping } from '@/services/export-mappings';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth }) => listExportMappings(auth),
  POST: async ({ req, auth }) => saveExportMapping(auth, null, await parseJson(req, exportMappingInput)),
});
