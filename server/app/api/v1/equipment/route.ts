import { equipmentInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createEquipment, listEquipment } from '@/services/equipment';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const q = (k: string) => url.searchParams.get(k)?.trim() || undefined;
    return listEquipment(auth, { q: q('q'), companyId: q('companyId'), siteId: q('siteId'), category: q('category'), includeInactive: q('includeInactive') === 'true' });
  },
  POST: async ({ req, auth }) => createEquipment(auth, await parseJson(req, equipmentInput)),
});
