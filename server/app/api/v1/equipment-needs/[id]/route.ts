import { equipmentNeedInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteEquipmentNeed, saveEquipmentNeed } from '@/services/planning';

export const { PUT, DELETE, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => saveEquipmentNeed(auth, params.id!, await parseJson(req, equipmentNeedInput)),
  DELETE: async ({ auth, params }) => deleteEquipmentNeed(auth, params.id!),
});
