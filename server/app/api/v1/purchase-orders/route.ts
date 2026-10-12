import { poInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createPo, listPos } from '@/services/purchasing';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const q = (k: string) => url.searchParams.get(k)?.trim() || undefined;
    return listPos(auth, { show: q('show') as never, q: q('q'), siteId: q('siteId'), equipmentId: q('equipmentId'), companyId: q('companyId') });
  },
  POST: async ({ req, auth }) => createPo(auth, await parseJson(req, poInput)),
});
