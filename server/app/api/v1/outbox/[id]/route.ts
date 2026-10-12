import { outboxEditInput } from '@supplyline/core/models';
import { parseJson, route } from '@/lib/http';
import { discardOutbox, editOutbox } from '@/services/mail';

export const { PATCH, DELETE, OPTIONS } = route({
  PATCH: async ({ req, auth, params }) => editOutbox(auth, params.id!, await parseJson(req, outboxEditInput)),
  DELETE: async ({ auth, params }) => discardOutbox(auth, params.id!),
});
