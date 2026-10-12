import { SITE_TYPES, siteInput, type SiteType } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createSite, listSites } from '@/services/sites';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const type = url.searchParams.get('type');
    return listSites(auth, {
      type: (SITE_TYPES as readonly string[]).includes(type ?? '') ? (type as SiteType) : undefined,
      companyId: url.searchParams.get('companyId') ?? undefined,
      includeInactive: url.searchParams.get('includeInactive') === 'true',
      q: url.searchParams.get('q')?.trim() || undefined,
    });
  },
  POST: async ({ req, auth }) => createSite(auth, await parseJson(req, siteInput)),
});
