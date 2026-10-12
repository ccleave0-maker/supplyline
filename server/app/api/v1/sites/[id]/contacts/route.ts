import { siteContactsInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { setSiteContacts } from '@/services/sites';

export const { PUT, OPTIONS } = route({
  PUT: async ({ req, auth, params }) => {
    const { contacts } = await parseJson(req, siteContactsInput);
    await setSiteContacts(auth, params.id!, contacts);
    return { ok: true };
  },
});
