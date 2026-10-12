import { contactInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { deleteContact, updateContact } from '@/services/contacts';

export const { PATCH, DELETE, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => updateContact(auth, params.id!, await parseJson(req, contactInput.partial())),
  DELETE: async ({ auth, params }) => {
    await deleteContact(auth, params.id!);
    return { ok: true };
  },
});
