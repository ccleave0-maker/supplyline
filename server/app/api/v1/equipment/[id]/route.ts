import { equipmentInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { getEquipment, updateEquipment } from '@/services/equipment';

export const { GET, PATCH, OPTIONS } = route({
  GET: async ({ auth, params }) => getEquipment(auth, params.id!),
  PATCH: async ({ req, auth, params }) => updateEquipment(auth, params.id!, await parseJson(req, equipmentInput.partial())),
});
