import { z } from 'zod';
import { parseJson, route } from '@/lib/http';
import { setEquipmentPriority } from '@/services/planning';

// Which job goes first when jobs want the same equipment (lower = first).
export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => setEquipmentPriority(auth, params.id!, (await parseJson(req, z.object({ priority: z.number().int().min(1).max(999) }))).priority),
});
