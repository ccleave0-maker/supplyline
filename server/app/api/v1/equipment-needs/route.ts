import { equipmentNeedInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { listEquipmentNeeds, saveEquipmentNeed } from '@/services/planning';

// Pre-job equipment plan: needs, what we own that can cover them, competing jobs.
export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => listEquipmentNeeds(auth, { siteId: url.searchParams.get('siteId') ?? undefined, from: url.searchParams.get('from') ?? undefined, to: url.searchParams.get('to') ?? undefined }),
  POST: async ({ req, auth }) => saveEquipmentNeed(auth, null, await parseJson(req, equipmentNeedInput)),
});
