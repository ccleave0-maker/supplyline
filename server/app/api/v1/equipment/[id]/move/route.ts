import { equipmentMoveInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { moveEquipment } from '@/services/equipment';

export const { POST, OPTIONS } = route({
  POST: async ({ req, auth, params }) => moveEquipment(auth, params.id!, await parseJson(req, equipmentMoveInput)),
});
