import { bolInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createBol, listBols } from '@/services/bols';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) =>
    listBols(auth, {
      status: url.searchParams.get('status') || undefined,
      siteId: url.searchParams.get('siteId') || undefined,
      companyId: url.searchParams.get('companyId') || undefined,
    }),
  POST: async ({ req, auth }) => createBol(auth, await parseJson(req, bolInput)),
});
