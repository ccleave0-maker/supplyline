import { exportMappingInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteExportMapping, saveExportMapping } from '@/services/export-mappings';

export const { PUT, DELETE, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveExportMapping(auth, params.id!, await parseJson(req, exportMappingInput)),
  DELETE: async ({ auth, params }) => deleteExportMapping(auth, params.id!),
});
