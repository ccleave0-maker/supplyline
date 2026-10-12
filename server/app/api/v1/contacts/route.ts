import { CONTACT_TYPES, contactInput, type ContactType } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { createContact, listContacts } from '@/services/contacts';

export const { GET, POST, OPTIONS } = route({
  GET: async ({ auth, url }) => {
    const type = url.searchParams.get('type');
    return listContacts(auth, {
      q: url.searchParams.get('q')?.trim() || undefined,
      type: (CONTACT_TYPES as readonly string[]).includes(type ?? '') ? (type as ContactType) : undefined,
      includeInactive: url.searchParams.get('includeInactive') === 'true',
    });
  },
  POST: async ({ req, auth }) => createContact(auth, await parseJson(req, contactInput)),
});
