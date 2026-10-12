import { equipmentImportInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { importEquipment } from '@/services/equipment';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth }) => importEquipment(auth, await parseJson(req, equipmentImportInput)),
});
